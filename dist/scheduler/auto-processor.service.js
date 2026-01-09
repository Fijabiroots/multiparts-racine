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
var AutoProcessorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoProcessorService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const email_service_1 = require("../email/email.service");
const detector_service_1 = require("../detector/detector.service");
const document_parser_service_1 = require("../parser/document-parser.service");
const excel_service_1 = require("../excel/excel.service");
const draft_service_1 = require("../draft/draft.service");
let AutoProcessorService = AutoProcessorService_1 = class AutoProcessorService {
    constructor(databaseService, emailService, detectorService, documentParser, excelService, draftService) {
        this.databaseService = databaseService;
        this.emailService = emailService;
        this.detectorService = detectorService;
        this.documentParser = documentParser;
        this.excelService = excelService;
        this.draftService = draftService;
        this.logger = new common_1.Logger(AutoProcessorService_1.name);
    }
    async processNewEmails(options) {
        const result = {
            processed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            details: [],
        };
        for (const folder of options.folders) {
            try {
                const emails = await this.emailService.fetchEmails({
                    folder,
                    unseen: true,
                    limit: 50,
                });
                this.logger.log(`${emails.length} emails non lus trouvés dans ${folder}`);
                for (const email of emails) {
                    if (options.endDate && email.date > options.endDate) {
                        result.skipped++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'skipped',
                            error: 'Email après la date limite',
                        });
                        continue;
                    }
                    const isProcessed = await this.databaseService.isEmailProcessed(email.id);
                    if (isProcessed) {
                        result.skipped++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'skipped',
                            error: 'Déjà traité',
                        });
                        continue;
                    }
                    const supplierCheck = await this.isSupplierQuote(email);
                    if (supplierCheck.isSupplierQuote) {
                        result.skipped++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'skipped',
                            error: `Offre fournisseur détectée: ${supplierCheck.reason}`,
                        });
                        await this.databaseService.addProcessingLog({
                            emailId: email.id,
                            action: 'filter',
                            status: 'skipped',
                            message: `Offre fournisseur: ${supplierCheck.reason}`,
                        });
                        continue;
                    }
                    const detection = await this.detectorService.analyzeEmail(email);
                    if (!detection.isPriceRequest) {
                        result.skipped++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'not_price_request',
                            error: detection.reason,
                        });
                        await this.databaseService.addProcessingLog({
                            emailId: email.id,
                            action: 'analyze',
                            status: 'skipped',
                            message: detection.reason,
                        });
                        continue;
                    }
                    result.processed++;
                    try {
                        const processResult = await this.processEmail(email, options.autoSendDraft);
                        result.successful++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'success',
                            internalRfqNumber: processResult.internalRfqNumber,
                            clientRfqNumber: processResult.clientRfqNumber,
                        });
                    }
                    catch (error) {
                        result.failed++;
                        result.details.push({
                            emailId: email.id,
                            subject: email.subject,
                            status: 'failed',
                            error: error.message,
                        });
                        await this.databaseService.addProcessingLog({
                            emailId: email.id,
                            action: 'process',
                            status: 'error',
                            message: error.message,
                        });
                    }
                }
            }
            catch (error) {
                this.logger.error(`Erreur lecture dossier ${folder}:`, error.message);
            }
        }
        return result;
    }
    async processEmail(email, autoSendDraft) {
        const client = await this.findOrCreateClient(email);
        const parsedDocs = await this.documentParser.parseAllAttachments(email.attachments);
        const emailBodyData = this.documentParser.parseEmailBody(email.body, email.subject);
        parsedDocs.push(emailBodyData);
        let clientRfqNumber;
        for (const doc of parsedDocs) {
            if (doc.rfqNumber) {
                clientRfqNumber = doc.rfqNumber;
                break;
            }
        }
        const allItems = [];
        const seenDescriptions = new Set();
        for (const doc of parsedDocs) {
            for (const item of doc.items) {
                const key = `${item.description.toLowerCase()}-${item.quantity}`;
                if (!seenDescriptions.has(key)) {
                    seenDescriptions.add(key);
                    allItems.push({
                        ...item,
                        notes: item.notes || `Source: ${doc.filename}`,
                    });
                }
            }
        }
        if (allItems.length === 0) {
            allItems.push({
                description: 'Article à définir - voir documents joints',
                quantity: 1,
                notes: 'Veuillez consulter les pièces jointes pour les détails',
            });
        }
        const internalRfqNumber = this.excelService.generateRequestNumber();
        const priceRequest = {
            requestNumber: internalRfqNumber,
            date: new Date(),
            items: allItems,
            notes: `Réf. interne: ${internalRfqNumber}`,
            deadline: this.calculateDeadline(14),
        };
        const generated = await this.excelService.generatePriceRequestExcel(priceRequest);
        const mapping = await this.databaseService.createRfqMapping({
            clientId: client?.id,
            clientRfqNumber,
            internalRfqNumber,
            emailId: email.id,
            emailSubject: email.subject,
            receivedAt: email.date,
            status: 'processed',
            excelPath: generated.excelPath,
        });
        if (autoSendDraft) {
            const senderEmail = this.extractEmail(email.from);
            const senderName = this.extractName(email.from);
            const clientName = client?.name || senderName || this.extractCompanyFromEmail(senderEmail);
            const draftId = await this.databaseService.createPendingDraft({
                rfqMappingId: mapping?.id,
                internalRfqNumber,
                clientRfqNumber,
                clientName: clientName,
                clientEmail: senderEmail,
                recipient: 'procurement@multipartsci.com',
                subject: `Demande de Prix N° ${internalRfqNumber}${clientRfqNumber ? ` - Réf. Client: ${clientRfqNumber}` : ''}`,
                excelPath: generated.excelPath,
                attachmentPaths: email.attachments
                    .filter(att => att.contentType?.startsWith('image/'))
                    .map(att => att.filename),
            });
            await this.databaseService.addOutputLog({
                draftId,
                rfqMappingId: mapping?.id,
                internalRfqNumber,
                clientRfqNumber,
                clientName,
                recipient: 'procurement@multipartsci.com',
                subject: `Demande de Prix N° ${internalRfqNumber}`,
                excelPath: generated.excelPath,
                action: 'draft_created',
                status: 'pending',
            });
            this.logger.log(`Brouillon créé: ${draftId}, envoi prévu au prochain cycle`);
            try {
                await this.draftService.saveToDrafts({
                    to: 'procurement@multipartsci.com',
                    subject: `Demande de Prix N° ${internalRfqNumber}${clientRfqNumber ? ` - Réf. Client: ${clientRfqNumber}` : ''}`,
                    body: this.generateEmailBodyForProcurement(internalRfqNumber, clientRfqNumber, clientName, senderEmail, allItems.length),
                    attachments: [{
                            filename: `${internalRfqNumber}.xlsx`,
                            content: generated.excelBuffer,
                            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        }],
                });
            }
            catch (error) {
                this.logger.warn(`Impossible de sauvegarder dans IMAP Drafts: ${error.message}`);
            }
            if (mapping) {
                await this.databaseService.updateRfqMappingStatus(mapping.id, 'draft_pending');
            }
        }
        await this.databaseService.addProcessingLog({
            rfqMappingId: mapping?.id,
            emailId: email.id,
            action: 'process',
            status: 'success',
            message: `Traité avec succès. RFQ interne: ${internalRfqNumber}, RFQ client: ${clientRfqNumber || 'non détecté'}`,
        });
        return {
            internalRfqNumber,
            clientRfqNumber,
            excelPath: generated.excelPath,
        };
    }
    async findOrCreateClient(email) {
        const senderEmail = this.extractEmail(email.from);
        let client = await this.databaseService.getClientByEmail(senderEmail);
        if (!client) {
            const senderName = this.extractName(email.from);
            const code = this.generateClientCode(senderName || senderEmail);
            try {
                client = await this.databaseService.createClient({
                    code,
                    name: senderName || senderEmail.split('@')[0],
                    email: senderEmail,
                });
                if (client) {
                    this.logger.log(`Nouveau client créé: ${client.code}`);
                }
            }
            catch (error) {
                client = await this.databaseService.getClientByEmail(senderEmail);
            }
        }
        return client;
    }
    extractEmail(from) {
        const match = from.match(/<([^>]+)>/) || from.match(/([\w.-]+@[\w.-]+\.\w+)/);
        return match ? match[1] : from;
    }
    extractName(from) {
        const match = from.match(/^"?([^"<]+)"?\s*</);
        if (match) {
            return match[1].trim();
        }
        return undefined;
    }
    generateClientCode(base) {
        const prefix = base.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
        const timestamp = Date.now().toString(36).toUpperCase().substring(-4);
        return `CLI-${prefix}${timestamp}`;
    }
    calculateDeadline(days) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + days);
        return deadline;
    }
    extractCompanyFromEmail(email) {
        const match = email.match(/@([^.]+)\./);
        if (match) {
            return match[1].toUpperCase();
        }
        return 'CLIENT';
    }
    generateEmailBodyForProcurement(internalRfqNumber, clientRfqNumber, clientName, clientEmail, itemsCount) {
        const responseHours = 24;
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + responseHours);
        return `Bonjour,

Veuillez trouver ci-joint une nouvelle demande de prix à traiter.

═══════════════════════════════════════════════════════
INFORMATIONS DEMANDE
═══════════════════════════════════════════════════════
N° Demande interne: ${internalRfqNumber}
Date: ${new Date().toLocaleDateString('fr-FR')}
Nombre d'articles: ${itemsCount}
Délai de réponse: ${responseHours}h (avant le ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})

═══════════════════════════════════════════════════════
INFORMATIONS CLIENT
═══════════════════════════════════════════════════════
Client: ${clientName || 'Non spécifié'}
Réf. Client: ${clientRfqNumber || 'Non spécifié'}
Contact: ${clientEmail}

═══════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════
1. Ouvrir le fichier Excel joint
2. Rechercher les prix fournisseurs
3. Compléter les colonnes "Prix Unitaire HT"
4. Retourner le fichier complété

---
Ce message a été généré automatiquement par le système de gestion des demandes de prix.
Ce brouillon sera envoyé automatiquement s'il n'est pas traité manuellement.`;
    }
    generateAnonymizedEmailBody(rfqNumber, itemsCount) {
        return `Madame, Monsieur,

Suite à votre demande, nous vous prions de bien vouloir nous faire parvenir votre meilleure offre de prix pour les articles détaillés dans le fichier Excel ci-joint.

Référence de la demande : ${rfqNumber}
Nombre d'articles : ${itemsCount}

Merci de compléter les colonnes "Prix Unitaire HT" du fichier Excel et de nous le retourner dans les meilleurs délais.

Cordialement,

---
Ce message a été généré automatiquement.
Pour toute correspondance, veuillez utiliser la référence : ${rfqNumber}`;
    }
    async isSupplierQuote(email) {
        const subject = email.subject.toLowerCase();
        const body = email.body.toLowerCase();
        const from = email.from.toLowerCase();
        if (/^(re:|fw:|fwd:|tr:)/i.test(email.subject)) {
            if (subject.includes('demande de prix') || subject.includes('ddp-')) {
                return { isSupplierQuote: true, reason: 'Réponse à une demande de prix' };
            }
        }
        const supplierKeywords = [
            'offre de prix',
            'proposition commerciale',
            'cotation',
            'notre offre',
            'votre demande',
            'suite à votre',
            'en réponse à',
            'quotation',
            'our quote',
            'price quotation',
            'proforma',
            'pro forma',
            'invoice',
            'facture',
        ];
        for (const keyword of supplierKeywords) {
            if (subject.includes(keyword) || body.substring(0, 500).includes(keyword)) {
                return { isSupplierQuote: true, reason: `Mot-clé fournisseur: "${keyword}"` };
            }
        }
        const senderEmail = this.extractEmail(from);
        const isKnownSupplier = await this.databaseService.isKnownSupplier(senderEmail);
        if (isKnownSupplier) {
            return { isSupplierQuote: true, reason: `Fournisseur connu: ${senderEmail}` };
        }
        if (/ddp-\d{8}-\d{3}/i.test(subject)) {
            return { isSupplierQuote: true, reason: 'Référence interne DDP détectée' };
        }
        const offerPatterns = [
            /total\s*:\s*[\d\s.,]+\s*(€|EUR|USD|XOF)/i,
            /prix\s*total\s*:\s*[\d\s.,]+/i,
            /montant\s*(ht|ttc)\s*:\s*[\d\s.,]+/i,
            /veuillez\s+trouver\s+(ci-joint|en\s+pj)\s+(notre|votre)\s+offre/i,
            /nous\s+vous\s+(proposons|offrons)/i,
        ];
        for (const pattern of offerPatterns) {
            if (pattern.test(body)) {
                return { isSupplierQuote: true, reason: 'Pattern d\'offre détecté dans le corps' };
            }
        }
        const knownClientDomains = [
            'endeavourmining.com',
            'endeavour.com',
            'ity.ci',
        ];
        const senderDomain = senderEmail.split('@')[1];
        if (knownClientDomains.some(d => senderDomain?.includes(d))) {
            return { isSupplierQuote: false };
        }
        return { isSupplierQuote: false };
    }
};
exports.AutoProcessorService = AutoProcessorService;
exports.AutoProcessorService = AutoProcessorService = AutoProcessorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        email_service_1.EmailService,
        detector_service_1.DetectorService,
        document_parser_service_1.DocumentParserService,
        excel_service_1.ExcelService,
        draft_service_1.DraftService])
], AutoProcessorService);
//# sourceMappingURL=auto-processor.service.js.map