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
var InboundScannerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InboundScannerService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const Imap = require("imap");
const mailparser_1 = require("mailparser");
const rfq_lifecycle_service_1 = require("./rfq-lifecycle.service");
const quote_comparison_service_1 = require("./quote-comparison.service");
const webhook_service_1 = require("../webhook/webhook.service");
const brand_intelligence_service_1 = require("../brand-intelligence/brand-intelligence.service");
let InboundScannerService = InboundScannerService_1 = class InboundScannerService {
    constructor(configService, rfqLifecycleService, quoteComparisonService, webhookService, brandIntelligence) {
        this.configService = configService;
        this.rfqLifecycleService = rfqLifecycleService;
        this.quoteComparisonService = quoteComparisonService;
        this.webhookService = webhookService;
        this.brandIntelligence = brandIntelligence;
        this.logger = new common_1.Logger(InboundScannerService_1.name);
        this.monitoredInboxes = [
            'procurement@multipartsci.com',
            'rafiou.oyeossi@multipartsci.com',
        ];
        this.declineKeywords = [
            'ne sommes pas en mesure',
            'pas en mesure de répondre',
            'déclinons',
            'refusons',
            'cannot quote',
            'unable to quote',
            'not able to provide',
            'regret to inform',
            'pas disponible',
            'not available',
            'hors stock',
            'out of stock',
            'ne fabriquons plus',
            'discontinued',
        ];
    }
    async scheduledInboundScan() {
        this.logger.log('📥 Scan des emails entrants pour réponses fournisseurs...');
        await this.scanInboundEmails();
    }
    async scanInboundEmails() {
        let quotesCount = 0;
        let declinesCount = 0;
        try {
            const imapConfig = this.getImapConfig();
            const imap = new Imap(imapConfig);
            await new Promise((resolve, reject) => {
                imap.once('ready', () => {
                    imap.openBox('INBOX', false, async (err, box) => {
                        if (err) {
                            this.logger.error(`Erreur ouverture INBOX: ${err.message}`);
                            imap.end();
                            resolve();
                            return;
                        }
                        const sevenDaysAgo = new Date();
                        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                        imap.search([['SINCE', sevenDaysAgo], 'UNSEEN'], async (searchErr, results) => {
                            if (searchErr || !results || results.length === 0) {
                                this.logger.debug('Aucun nouvel email à traiter');
                                imap.end();
                                resolve();
                                return;
                            }
                            this.logger.log(`${results.length} email(s) non lu(s) à analyser`);
                            const fetch = imap.fetch(results, {
                                bodies: '',
                                struct: true,
                                markSeen: false
                            });
                            const emails = [];
                            fetch.on('message', (msg, seqno) => {
                                let buffer = '';
                                let uid;
                                msg.on('body', (stream) => {
                                    stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                                });
                                msg.once('attributes', (attrs) => {
                                    uid = attrs.uid;
                                });
                                msg.once('end', () => {
                                    emails.push({ uid, buffer });
                                });
                            });
                            fetch.once('end', async () => {
                                for (const { uid, buffer } of emails) {
                                    try {
                                        const parsed = await (0, mailparser_1.simpleParser)(buffer);
                                        const result = await this.processInboundEmail(parsed, imap, uid);
                                        if (result === 'quote')
                                            quotesCount++;
                                        if (result === 'decline')
                                            declinesCount++;
                                    }
                                    catch (e) {
                                        this.logger.debug(`Erreur traitement email: ${e.message}`);
                                    }
                                }
                                imap.end();
                                resolve();
                            });
                        });
                    });
                });
                imap.once('error', (err) => {
                    this.logger.error(`Erreur IMAP: ${err.message}`);
                    resolve();
                });
                imap.connect();
            });
        }
        catch (error) {
            this.logger.error(`Erreur scan emails entrants: ${error.message}`);
        }
        if (quotesCount > 0 || declinesCount > 0) {
            this.logger.log(`📊 Résultat scan: ${quotesCount} offre(s), ${declinesCount} refus`);
        }
        return { quotes: quotesCount, declines: declinesCount };
    }
    async processInboundEmail(parsed, imap, uid) {
        const from = parsed.from?.text?.toLowerCase() || '';
        const to = parsed.to?.text?.toLowerCase() || '';
        const subject = parsed.subject || '';
        const body = parsed.text || parsed.html || '';
        const attachments = parsed.attachments || [];
        const rfqNumber = this.findRfqReference(subject, body);
        if (!rfqNumber) {
            return 'ignored';
        }
        const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
        if (!rfq) {
            return 'ignored';
        }
        const supplierEmail = this.extractEmail(from);
        const isKnownSupplier = rfq.suppliers.some(s => s.email.toLowerCase() === supplierEmail ||
            supplierEmail.includes(s.email.split('@')[0]));
        if (!isKnownSupplier) {
            this.logger.debug(`Email de ${supplierEmail} pour ${rfqNumber} - fournisseur non reconnu`);
        }
        const detectedBrands = this.brandIntelligence.detectBrands(`${rfq.subject} ${body}`);
        const isDecline = this.isDeclineEmail(subject, body);
        if (isDecline) {
            this.rfqLifecycleService.registerSupplierDecline(rfqNumber, supplierEmail);
            if (detectedBrands.length > 0) {
                await this.brandIntelligence.recordSupplierResponse(supplierEmail, undefined, detectedBrands, false);
                this.logger.log(`📊 Refus enregistré: ${supplierEmail} -> ${detectedBrands.join(', ')}`);
            }
            await this.webhookService.emitQuoteDeclined(rfqNumber, supplierEmail);
            imap.addFlags(uid, ['\\Seen'], () => { });
            return 'decline';
        }
        const quote = await this.extractQuoteData(parsed, supplierEmail, rfqNumber);
        if (quote) {
            this.rfqLifecycleService.registerSupplierQuote(quote);
            if (detectedBrands.length > 0) {
                await this.brandIntelligence.recordSupplierResponse(supplierEmail, quote.supplierName, detectedBrands, true, quote.totalAmount !== undefined && quote.totalAmount > 0);
                this.logger.log(`📊 Offre enregistrée: ${supplierEmail} -> ${detectedBrands.join(', ')}`);
            }
            await this.webhookService.emitQuoteReceived(rfqNumber, supplierEmail, quote.supplierName, quote.totalAmount, quote.currency);
            await this.checkAndGenerateComparison(rfqNumber, rfq.subject, quote);
            imap.addFlags(uid, ['\\Seen'], () => { });
            return 'quote';
        }
        return 'ignored';
    }
    findRfqReference(subject, body) {
        const combined = subject + ' ' + body;
        const patterns = [
            /RFQ[\s\-_:]*([A-Z0-9\-]+)/i,
            /(?:Réf|Ref|Reference)[:\s]*([A-Z0-9\-]+)/i,
            /(?:N°|No\.?)[:\s]*([A-Z0-9\-]+)/i,
            /PR[\s\-_]*(\d{6,})/i,
            /(?:votre\s+demande|your\s+request)[^\d]*([A-Z0-9\-]+)/i,
        ];
        for (const pattern of patterns) {
            const match = combined.match(pattern);
            if (match) {
                const rfqNumber = match[1];
                if (this.rfqLifecycleService.getRfqByNumber(rfqNumber)) {
                    return rfqNumber;
                }
            }
        }
        for (const rfq of this.rfqLifecycleService.getSentRfqs()) {
            if (combined.includes(rfq.internalRfqNumber)) {
                return rfq.internalRfqNumber;
            }
            if (rfq.clientRfqNumber && combined.includes(rfq.clientRfqNumber)) {
                return rfq.internalRfqNumber;
            }
        }
        return null;
    }
    isDeclineEmail(subject, body) {
        const combined = (subject + ' ' + body).toLowerCase();
        return this.declineKeywords.some(kw => combined.includes(kw));
    }
    async extractQuoteData(parsed, supplierEmail, rfqNumber) {
        const attachments = parsed.attachments || [];
        const body = parsed.text || parsed.html || '';
        let quote = null;
        for (const att of attachments) {
            const filename = att.filename?.toLowerCase() || '';
            if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
                try {
                    quote = await this.quoteComparisonService.parseExcelQuote(att.content, supplierEmail, rfqNumber);
                    quote.attachments.push(filename);
                    quote.subject = parsed.subject;
                    quote.supplierName = this.extractName(parsed.from?.text);
                    if (!quote.needsManualReview && quote.items.length > 0) {
                        return quote;
                    }
                }
                catch (e) {
                    this.logger.debug(`Erreur parsing Excel ${filename}: ${e.message}`);
                }
            }
        }
        for (const att of attachments) {
            const filename = att.filename?.toLowerCase() || '';
            if (filename.endsWith('.pdf')) {
                try {
                    const pdfQuote = await this.quoteComparisonService.parsePdfQuote(att.content, supplierEmail, rfqNumber);
                    pdfQuote.attachments.push(filename);
                    pdfQuote.subject = parsed.subject;
                    pdfQuote.supplierName = this.extractName(parsed.from?.text);
                    if (!quote || (pdfQuote.items.length > quote.items.length)) {
                        quote = pdfQuote;
                    }
                }
                catch (e) {
                    this.logger.debug(`Erreur parsing PDF ${filename}: ${e.message}`);
                }
            }
        }
        if (!quote || quote.items.length === 0) {
            quote = this.quoteComparisonService.parseEmailBodyQuote(body, supplierEmail, rfqNumber);
            quote.subject = parsed.subject;
            quote.supplierName = this.extractName(parsed.from?.text);
        }
        if (quote && (quote.items.length > 0 || quote.totalAmount)) {
            return quote;
        }
        return {
            supplierEmail,
            rfqNumber,
            receivedAt: parsed.date || new Date(),
            subject: parsed.subject || '',
            supplierName: this.extractName(parsed.from?.text),
            items: [],
            attachments: attachments.map((a) => a.filename || 'attachment'),
            rawText: body.substring(0, 2000),
            needsManualReview: true,
        };
    }
    async checkAndGenerateComparison(rfqNumber, rfqSubject, newQuote) {
        const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
        if (!rfq)
            return;
        try {
            if (newQuote) {
                const comparison = await this.quoteComparisonService.addOrUpdateQuote(rfqNumber, newQuote, rfqSubject || rfq.subject, rfq.clientRfqNumber);
                this.logger.log(`📊 Comparatif mis à jour: ${comparison.filePath} (${comparison.suppliers.length} fournisseur(s))`);
            }
            const responded = rfq.suppliers.filter(s => s.status === 'offre_reçue' || s.status === 'refus').length;
            if (responded === rfq.suppliers.length && rfq.suppliers.length > 0) {
                const comparison = this.quoteComparisonService.getExistingComparison(rfqNumber);
                if (comparison) {
                    await this.webhookService.emitComparisonComplete(rfqNumber, comparison.filePath, comparison.recommendation);
                    this.logger.log(`✅ Comparatif complet: ${rfqNumber} - Tous les fournisseurs ont répondu`);
                }
            }
        }
        catch (error) {
            this.logger.error(`Erreur génération comparatif: ${error.message}`);
        }
    }
    extractEmail(text) {
        const match = text.match(/<([^>]+)>/) || text.match(/([\w.-]+@[\w.-]+\.\w+)/);
        return match ? match[1].toLowerCase() : text.toLowerCase();
    }
    extractName(text) {
        if (!text)
            return undefined;
        const match = text.match(/^"?([^"<]+)"?\s*</);
        return match ? match[1].trim() : undefined;
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
};
exports.InboundScannerService = InboundScannerService;
__decorate([
    (0, schedule_1.Cron)('*/10 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], InboundScannerService.prototype, "scheduledInboundScan", null);
exports.InboundScannerService = InboundScannerService = InboundScannerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        rfq_lifecycle_service_1.RfqLifecycleService,
        quote_comparison_service_1.QuoteComparisonService,
        webhook_service_1.WebhookService,
        brand_intelligence_service_1.BrandIntelligenceService])
], InboundScannerService);
//# sourceMappingURL=inbound-scanner.service.js.map