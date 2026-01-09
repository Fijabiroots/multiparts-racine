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
var PriceRequestService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceRequestService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const email_service_1 = require("../email/email.service");
const pdf_service_1 = require("../pdf/pdf.service");
const excel_service_1 = require("../excel/excel.service");
const draft_service_1 = require("../draft/draft.service");
const acknowledgment_service_1 = require("../acknowledgment/acknowledgment.service");
const tracking_service_1 = require("../tracking/tracking.service");
const webhook_service_1 = require("../webhook/webhook.service");
let PriceRequestService = PriceRequestService_1 = class PriceRequestService {
    constructor(configService, emailService, pdfService, excelService, draftService, acknowledgmentService, trackingService, webhookService) {
        this.configService = configService;
        this.emailService = emailService;
        this.pdfService = pdfService;
        this.excelService = excelService;
        this.draftService = draftService;
        this.acknowledgmentService = acknowledgmentService;
        this.trackingService = trackingService;
        this.webhookService = webhookService;
        this.logger = new common_1.Logger(PriceRequestService_1.name);
        this.DEFAULT_RECIPIENT = 'procurement@multipartsci.com';
        this.DEFAULT_RESPONSE_HOURS = 24;
    }
    async processEmailById(emailId, folder = 'INBOX', supplierEmail) {
        try {
            const email = await this.emailService.fetchEmailById(emailId, folder);
            if (!email) {
                return { success: false, error: 'Email non trouvé' };
            }
            return this.processEmail(email, supplierEmail);
        }
        catch (error) {
            this.logger.error(`Erreur traitement email ${emailId}:`, error.message);
            return { success: false, error: error.message };
        }
    }
    async processEmail(email, supplierEmail) {
        try {
            const pdfAttachments = email.attachments.filter((att) => att.contentType === 'application/pdf' || att.filename?.toLowerCase().endsWith('.pdf'));
            const additionalAttachments = email.attachments.filter((att) => {
                const lowerType = att.contentType.toLowerCase();
                const lowerName = att.filename?.toLowerCase() || '';
                if (lowerName.includes('outlook-') || lowerName.includes('outlook_') ||
                    lowerName.startsWith('image') || lowerName.match(/^cid:/i)) {
                    return false;
                }
                return lowerType.includes('image') ||
                    /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(lowerName) ||
                    /\.(doc|docx|xls|xlsx)$/i.test(lowerName);
            });
            let extractedData = [];
            let itemsFromBody = [];
            if (pdfAttachments.length > 0) {
                extractedData = await this.pdfService.extractFromAttachments(pdfAttachments);
            }
            if (extractedData.length === 0 || extractedData.every(d => d.items.length === 0)) {
                this.logger.log('Pas de PDF ou extraction vide, tentative depuis le corps de l\'email');
                itemsFromBody = this.pdfService.extractItemsFromEmailBody(email.body);
                if (itemsFromBody.length > 0) {
                    extractedData = [{
                            filename: 'email_body',
                            text: email.body,
                            items: itemsFromBody,
                            rfqNumber: this.extractRfqFromSubject(email.subject),
                        }];
                    this.logger.log(`${itemsFromBody.length} items extraits du corps de l'email`);
                }
            }
            if (extractedData.length === 0 || extractedData.every(d => d.items.length === 0)) {
                return {
                    success: false,
                    email,
                    error: 'Aucune demande détectée (ni dans les PDF, ni dans le corps de l\'email)'
                };
            }
            const priceRequest = this.buildPriceRequest(email, extractedData, supplierEmail);
            if (additionalAttachments.length > 0) {
                priceRequest.additionalAttachments = additionalAttachments;
                this.logger.log(`${additionalAttachments.length} pièce(s) jointe(s) complémentaire(s) ajoutée(s)`);
            }
            const generatedExcel = await this.excelService.generatePriceRequestExcel(priceRequest);
            const draftResult = await this.draftService.savePriceRequestDraft(generatedExcel, {
                recipientEmail: this.DEFAULT_RECIPIENT,
                autoDetectLanguage: true,
                additionalAttachments,
            });
            let acknowledgmentSent = false;
            const sendAck = this.configService.get('email.sendAcknowledgment', true);
            if (sendAck) {
                acknowledgmentSent = await this.sendAcknowledgmentToClient(email, priceRequest, extractedData);
            }
            let tracked = false;
            try {
                let deadline;
                for (const data of extractedData) {
                    if (data.deadline) {
                        deadline = data.deadline;
                        break;
                    }
                }
                if (!deadline) {
                    const deadlineMatch = email.body.match(/d[ée]lai\s+de\s+r[ée]ponse[:\s]+([^.\n]+)/i);
                    if (deadlineMatch) {
                        deadline = deadlineMatch[1].trim();
                    }
                }
                const needsReview = extractedData.some(d => d.needsVerification);
                const status = needsReview ? 'révision_manuelle' : 'traité';
                tracked = await this.trackingService.addEntry({
                    timestamp: new Date(),
                    clientRfqNumber: priceRequest.clientRfqNumber,
                    internalRfqNumber: priceRequest.requestNumber,
                    clientName: priceRequest.clientName,
                    clientEmail: priceRequest.clientEmail || '',
                    subject: email.subject,
                    itemCount: priceRequest.items.length,
                    status: status,
                    acknowledgmentSent,
                    deadline,
                    notes: needsReview ? 'Extraction OCR - vérification requise' : undefined,
                });
            }
            catch (trackError) {
                this.logger.warn(`Erreur tracking: ${trackError.message}`);
            }
            try {
                await this.webhookService.emitRfqProcessed(priceRequest.requestNumber, priceRequest.clientRfqNumber, priceRequest.items.length, generatedExcel.excelPath);
                if (acknowledgmentSent) {
                    const toArray = Array.isArray(email.to) ? email.to : [email.to];
                    await this.webhookService.emitAcknowledgmentSent(priceRequest.requestNumber, [email.from, ...toArray, ...(email.cc || [])].filter(Boolean));
                }
            }
            catch (webhookError) {
                this.logger.warn(`Erreur webhook: ${webhookError.message}`);
            }
            return {
                success: true,
                email,
                extractedData,
                priceRequest,
                generatedExcel,
                draftSaved: draftResult.success,
                acknowledgmentSent,
                tracked,
                error: draftResult.error,
            };
        }
        catch (error) {
            this.logger.error(`Erreur traitement email:`, error.message);
            try {
                await this.webhookService.emitSystemError(`Erreur traitement email: ${error.message}`, {
                    emailId: email?.id,
                    subject: email?.subject,
                });
            }
            catch (e) { }
            return { success: false, email, error: error.message };
        }
    }
    extractRfqFromSubject(subject) {
        const match = subject.match(/(?:RFQ|PR|REF)[\s\-_:]*([A-Z0-9\-]+)/i);
        return match ? match[1] : undefined;
    }
    async processUnreadEmails(folder = 'INBOX') {
        const results = [];
        let successful = 0;
        let failed = 0;
        try {
            const emails = await this.emailService.getUnreadEmailsWithPdfAttachments(folder);
            this.logger.log(`${emails.length} emails non lus avec PDF trouvés`);
            for (const email of emails) {
                const result = await this.processEmail(email);
                results.push(result);
                if (result.success) {
                    successful++;
                }
                else {
                    failed++;
                }
            }
        }
        catch (error) {
            this.logger.error('Erreur traitement emails non lus:', error.message);
        }
        return {
            processed: results.length,
            successful,
            failed,
            results,
        };
    }
    buildPriceRequest(email, extractedData, supplierEmail) {
        const allItems = [];
        const seenDescriptions = new Set();
        let clientRfqNumber;
        let generalDescription;
        for (const pdf of extractedData) {
            if (pdf.rfqNumber && !clientRfqNumber) {
                clientRfqNumber = pdf.rfqNumber;
            }
            if (pdf.generalDescription && !generalDescription) {
                generalDescription = pdf.generalDescription;
            }
            for (const item of pdf.items) {
                const key = `${item.description}-${item.quantity}`;
                if (!seenDescriptions.has(key)) {
                    seenDescriptions.add(key);
                    allItems.push({
                        ...item,
                        notes: item.notes || `Source: ${pdf.filename}`,
                    });
                }
            }
        }
        if (allItems.length === 0) {
            allItems.push({
                description: 'Article à définir (voir PDF joint)',
                quantity: 1,
                notes: 'Veuillez vous référer au PDF pour les détails',
            });
        }
        const clientEmail = this.extractEmailFromSender(email.from);
        const clientName = this.extractNameFromSender(email.from) || this.extractCompanyFromEmail(clientEmail);
        let clientCompany;
        for (const pdf of extractedData) {
            const supplierInfo = this.pdfService.extractSupplierInfo(pdf.text);
            if (supplierInfo.name && !clientCompany) {
                clientCompany = supplierInfo.name;
            }
        }
        return {
            requestNumber: this.excelService.generateRequestNumber(),
            clientRfqNumber: clientRfqNumber,
            clientName: clientCompany || clientName,
            clientEmail: clientEmail,
            date: new Date(),
            supplier: undefined,
            supplierEmail: supplierEmail || this.DEFAULT_RECIPIENT,
            items: allItems,
            notes: generalDescription || `Email: "${email.subject}" du ${email.date.toLocaleDateString('fr-FR')}`,
            responseDeadlineHours: this.DEFAULT_RESPONSE_HOURS,
            deadline: this.calculateDeadline(1),
            sourceEmail: email,
        };
    }
    extractEmailFromSender(from) {
        const match = from.match(/<([^>]+)>/) || from.match(/([\w.-]+@[\w.-]+\.\w+)/);
        return match ? match[1] : from;
    }
    extractNameFromSender(from) {
        const match = from.match(/^"?([^"<]+)"?\s*</);
        if (match) {
            return match[1].trim();
        }
        return undefined;
    }
    extractCompanyFromEmail(email) {
        const match = email.match(/@([^.]+)\./);
        if (match) {
            return match[1].toUpperCase();
        }
        return undefined;
    }
    calculateDeadline(daysFromNow = 1) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + daysFromNow);
        return deadline;
    }
    async sendAcknowledgmentToClient(email, priceRequest, extractedData) {
        try {
            const toArray = Array.isArray(email.to) ? email.to : (email.to ? [email.to] : []);
            const recipients = {
                from: email.from,
                to: toArray,
                cc: email.cc || [],
                replyTo: email.replyTo,
            };
            let deadline;
            for (const data of extractedData) {
                if (data.deadline) {
                    deadline = data.deadline;
                    break;
                }
            }
            if (!deadline) {
                const deadlineMatch = email.body.match(/d[ée]lai\s+de\s+r[ée]ponse[:\s]+([^.\n]+)/i);
                if (deadlineMatch) {
                    deadline = deadlineMatch[1].trim();
                }
            }
            let senderName;
            const nameMatch = email.body.match(/(?:cordialement|cdlt|regards)[,.\s]*\n+([A-ZÉÈÀÙÂÊÎÔÛÇ][A-ZÉÈÀÙÂÊÎÔÛÇ\s]+)\n/i);
            if (nameMatch) {
                senderName = nameMatch[1].trim();
            }
            else {
                senderName = this.extractNameFromSender(email.from);
            }
            const isUrgent = /urgent/i.test(email.subject) || /urgent/i.test(email.body);
            const acknowledgmentData = {
                rfqNumber: priceRequest.clientRfqNumber || priceRequest.requestNumber,
                subject: email.subject,
                itemCount: priceRequest.items.length,
                deadline,
                senderName,
                isUrgent,
                originalMessageId: email.messageId,
                originalReferences: email.references,
            };
            const delay = this.configService.get('email.acknowledgmentDelay', 5);
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
            const sent = await this.acknowledgmentService.sendAcknowledgment(recipients, acknowledgmentData);
            if (sent) {
                this.logger.log(`✉️ Accusé de réception envoyé pour: ${email.subject}`);
            }
            return sent;
        }
        catch (error) {
            this.logger.error(`Erreur envoi accusé de réception: ${error.message}`);
            return false;
        }
    }
    async generatePreview(emailId, folder = 'INBOX') {
        const email = await this.emailService.fetchEmailById(emailId, folder);
        if (!email) {
            return { error: 'Email non trouvé' };
        }
        const pdfAttachments = email.attachments.filter((att) => att.contentType === 'application/pdf');
        const extractedData = await this.pdfService.extractFromAttachments(pdfAttachments);
        return {
            email: {
                id: email.id,
                from: email.from,
                subject: email.subject,
                date: email.date,
            },
            pdfCount: pdfAttachments.length,
            extractedItems: extractedData.flatMap((d) => d.items),
            totalItems: extractedData.reduce((sum, d) => sum + d.items.length, 0),
        };
    }
};
exports.PriceRequestService = PriceRequestService;
exports.PriceRequestService = PriceRequestService = PriceRequestService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        email_service_1.EmailService,
        pdf_service_1.PdfService,
        excel_service_1.ExcelService,
        draft_service_1.DraftService,
        acknowledgment_service_1.AcknowledgmentService,
        tracking_service_1.TrackingService,
        webhook_service_1.WebhookService])
], PriceRequestService);
//# sourceMappingURL=price-request.service.js.map