"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RfqLifecycleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RfqLifecycleService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const Imap = require("imap");
const mailparser_1 = require("mailparser");
const fs = require("fs");
const path = require("path");
let RfqLifecycleService = RfqLifecycleService_1 = class RfqLifecycleService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(RfqLifecycleService_1.name);
        this.sentRfqs = new Map();
        this.supplierQuotes = new Map();
        this.monitoredEmails = [
            'procurement@multipartsci.com',
            'rafiou.oyeossi@multipartsci.com',
        ];
        const dataDir = this.configService.get('app.outputDir', './output');
        this.dataFilePath = path.join(dataDir, 'rfq-lifecycle-data.json');
        this.loadData();
    }
    loadData() {
        try {
            if (fs.existsSync(this.dataFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
                if (data.sentRfqs) {
                    this.sentRfqs = new Map(Object.entries(data.sentRfqs));
                }
                if (data.supplierQuotes) {
                    this.supplierQuotes = new Map(Object.entries(data.supplierQuotes));
                }
                this.logger.log(`Données RFQ lifecycle chargées: ${this.sentRfqs.size} RFQs`);
            }
        }
        catch (error) {
            this.logger.warn(`Erreur chargement données: ${error.message}`);
        }
    }
    saveData() {
        try {
            const dir = path.dirname(this.dataFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                sentRfqs: Object.fromEntries(this.sentRfqs),
                supplierQuotes: Object.fromEntries(this.supplierQuotes),
                lastUpdate: new Date().toISOString(),
            };
            fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
        }
        catch (error) {
            this.logger.error(`Erreur sauvegarde données: ${error.message}`);
        }
    }
    async scanSentEmails() {
        const newRfqs = [];
        try {
            const imapConfig = this.getImapConfig();
            const imap = new Imap(imapConfig);
            await new Promise((resolve, reject) => {
                imap.once('ready', async () => {
                    try {
                        const sentFolder = this.configService.get('drafts.sentFolder', 'INBOX.Sent');
                        imap.openBox(sentFolder, true, async (err, box) => {
                            if (err) {
                                this.logger.error(`Erreur ouverture dossier Sent: ${err.message}`);
                                imap.end();
                                resolve();
                                return;
                            }
                            const sevenDaysAgo = new Date();
                            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                            imap.search([['SINCE', sevenDaysAgo]], (searchErr, results) => {
                                if (searchErr || !results || results.length === 0) {
                                    imap.end();
                                    resolve();
                                    return;
                                }
                                const fetch = imap.fetch(results, { bodies: '', struct: true });
                                const emails = [];
                                fetch.on('message', (msg) => {
                                    let buffer = '';
                                    msg.on('body', (stream) => {
                                        stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                                    });
                                    msg.once('end', () => emails.push(buffer));
                                });
                                fetch.once('end', async () => {
                                    for (const emailBuffer of emails) {
                                        try {
                                            const parsed = await (0, mailparser_1.simpleParser)(emailBuffer);
                                            const rfq = await this.processOutboundEmail(parsed);
                                            if (rfq) {
                                                newRfqs.push(rfq);
                                            }
                                        }
                                        catch (e) {
                                        }
                                    }
                                    imap.end();
                                    resolve();
                                });
                            });
                        });
                    }
                    catch (e) {
                        imap.end();
                        reject(e);
                    }
                });
                imap.once('error', (err) => {
                    this.logger.error(`Erreur IMAP: ${err.message}`);
                    resolve();
                });
                imap.connect();
            });
            this.saveData();
            return newRfqs;
        }
        catch (error) {
            this.logger.error(`Erreur scan emails envoyés: ${error.message}`);
            return [];
        }
    }
    async processOutboundEmail(parsed) {
        const from = parsed.from?.text?.toLowerCase() || '';
        const to = parsed.to?.text || '';
        const cc = parsed.cc?.text || '';
        const subject = parsed.subject || '';
        const body = parsed.text || parsed.html || '';
        const messageId = parsed.messageId;
        if (!this.monitoredEmails.some(email => from.includes(email.toLowerCase()))) {
            return null;
        }
        const isRfq = this.isRfqEmail(subject, body);
        if (!isRfq) {
            return null;
        }
        const rfqNumber = this.extractRfqNumber(subject, body);
        if (!rfqNumber) {
            return null;
        }
        if (this.sentRfqs.has(rfqNumber)) {
            const existing = this.sentRfqs.get(rfqNumber);
            const newSuppliers = this.extractSupplierEmails(to, cc);
            for (const supplierEmail of newSuppliers) {
                if (!existing.suppliers.find(s => s.email === supplierEmail)) {
                    existing.suppliers.push({
                        email: supplierEmail,
                        consultedAt: parsed.date || new Date(),
                        rfqNumber,
                        status: 'consulté',
                        reminderCount: 0,
                    });
                }
            }
            return null;
        }
        const suppliers = this.extractSupplierEmails(to, cc).map(email => ({
            email,
            consultedAt: parsed.date || new Date(),
            rfqNumber,
            status: 'consulté',
            reminderCount: 0,
        }));
        if (suppliers.length === 0) {
            return null;
        }
        const sentRfq = {
            internalRfqNumber: rfqNumber,
            clientRfqNumber: this.extractClientRfqNumber(subject, body),
            subject,
            sentAt: parsed.date || new Date(),
            sentBy: from,
            suppliers,
            status: 'envoyé',
            itemCount: this.countItems(body),
        };
        const deadlineMatch = body.match(/(?:deadline|délai|avant le|before)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
        if (deadlineMatch) {
            sentRfq.deadline = new Date(deadlineMatch[1]);
        }
        this.sentRfqs.set(rfqNumber, sentRfq);
        this.logger.log(`Nouvelle demande détectée: ${rfqNumber} → ${suppliers.length} fournisseur(s)`);
        return sentRfq;
    }
    isRfqEmail(subject, body) {
        const combined = (subject + ' ' + body).toLowerCase();
        const rfqKeywords = [
            'demande de prix',
            'demande de cotation',
            'request for quotation',
            'rfq',
            'price request',
            'quotation request',
            'devis',
            'offre de prix',
            'consultation',
        ];
        return rfqKeywords.some(kw => combined.includes(kw));
    }
    extractRfqNumber(subject, body) {
        const combined = subject + ' ' + body;
        const patterns = [
            /RFQ[\s\-_:]*([A-Z0-9\-]+)/i,
            /(?:Réf|Ref|Reference)[:\s]*([A-Z0-9\-]+)/i,
            /(?:N°|No\.?)[:\s]*([A-Z0-9\-]+)/i,
            /PR[\s\-_]*(\d{6,})/i,
        ];
        for (const pattern of patterns) {
            const match = combined.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }
    extractClientRfqNumber(subject, body) {
        const combined = subject + ' ' + body;
        const match = combined.match(/(?:client|customer|PR)[:\s\-]*([A-Z0-9\-]+)/i);
        return match ? match[1] : undefined;
    }
    extractSupplierEmails(to, cc) {
        const combined = to + ',' + cc;
        const emailPattern = /[\w.-]+@[\w.-]+\.\w+/gi;
        const emails = combined.match(emailPattern) || [];
        return emails
            .map(e => e.toLowerCase())
            .filter(e => !this.monitoredEmails.some(m => e.includes(m.toLowerCase())))
            .filter(e => !e.includes('multipartsci.com'));
    }
    countItems(body) {
        const lines = body.split('\n');
        let count = 0;
        for (const line of lines) {
            if (/^\s*\d+[\.\)]\s+/.test(line) || /^\s*[-•]\s+\w/.test(line)) {
                count++;
            }
        }
        return count || 1;
    }
    getImapConfig() {
        return {
            user: this.configService.get('imap.user'),
            password: this.configService.get('imap.password'),
            host: this.configService.get('imap.host'),
            port: this.configService.get('imap.port'),
            tls: this.configService.get('imap.tls', true),
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
        };
    }
    getSentRfqs() {
        return Array.from(this.sentRfqs.values());
    }
    getRfqByNumber(rfqNumber) {
        return this.sentRfqs.get(rfqNumber);
    }
    getSuppliersNeedingReminder(maxReminderCount = 3, minDaysSinceLastContact = 2) {
        const suppliers = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - minDaysSinceLastContact);
        for (const rfq of this.sentRfqs.values()) {
            for (const supplier of rfq.suppliers) {
                if (supplier.status === 'consulté' ||
                    supplier.status === 'relancé' ||
                    supplier.status === 'sans_réponse') {
                    const lastContact = supplier.lastReminderAt || supplier.consultedAt;
                    if (lastContact < cutoffDate &&
                        supplier.reminderCount < maxReminderCount) {
                        suppliers.push(supplier);
                    }
                }
            }
        }
        return suppliers;
    }
    markSupplierReminded(rfqNumber, supplierEmail) {
        const rfq = this.sentRfqs.get(rfqNumber);
        if (rfq) {
            const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
            if (supplier) {
                supplier.status = 'relancé';
                supplier.lastReminderAt = new Date();
                supplier.reminderCount++;
                this.saveData();
            }
        }
    }
    registerSupplierQuote(quote) {
        const rfq = this.sentRfqs.get(quote.rfqNumber);
        if (rfq) {
            const supplier = rfq.suppliers.find(s => s.email === quote.supplierEmail);
            if (supplier) {
                supplier.status = 'offre_reçue';
                supplier.responseAt = quote.receivedAt;
                supplier.quoteReference = quote.subject;
            }
            const respondedCount = rfq.suppliers.filter(s => s.status === 'offre_reçue').length;
            if (respondedCount === rfq.suppliers.length) {
                rfq.status = 'complet';
            }
            else if (respondedCount > 0) {
                rfq.status = 'partiellement_répondu';
            }
        }
        const quotes = this.supplierQuotes.get(quote.rfqNumber) || [];
        quotes.push(quote);
        this.supplierQuotes.set(quote.rfqNumber, quotes);
        this.saveData();
        this.logger.log(`Offre enregistrée: ${quote.supplierEmail} pour ${quote.rfqNumber}`);
    }
    registerSupplierDecline(rfqNumber, supplierEmail) {
        const rfq = this.sentRfqs.get(rfqNumber);
        if (rfq) {
            const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
            if (supplier) {
                supplier.status = 'refus';
                supplier.responseAt = new Date();
                this.saveData();
                this.logger.log(`Refus enregistré: ${supplierEmail} pour ${rfqNumber}`);
            }
        }
    }
    getQuotesForRfq(rfqNumber) {
        return this.supplierQuotes.get(rfqNumber) || [];
    }
};
exports.RfqLifecycleService = RfqLifecycleService;
exports.RfqLifecycleService = RfqLifecycleService = RfqLifecycleService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RfqLifecycleService);
//# sourceMappingURL=rfq-lifecycle.service.js.map