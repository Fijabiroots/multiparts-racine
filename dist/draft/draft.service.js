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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var DraftService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const imapSimple = require("imap-simple");
const nodemailer = require("nodemailer");
const company_info_1 = require("../common/company-info");
const rfq_instructions_1 = require("../common/rfq-instructions");
const brand_intelligence_service_1 = require("../brand-intelligence/brand-intelligence.service");
let DraftService = DraftService_1 = class DraftService {
    constructor(configService, brandIntelligence) {
        this.configService = configService;
        this.brandIntelligence = brandIntelligence;
        this.logger = new common_1.Logger(DraftService_1.name);
    }
    getImapConfig() {
        return {
            imap: {
                host: this.configService.get('imap.host'),
                port: this.configService.get('imap.port'),
                user: this.configService.get('imap.user'),
                password: this.configService.get('imap.password'),
                tls: this.configService.get('imap.tls'),
                authTimeout: this.configService.get('imap.authTimeout'),
                tlsOptions: this.configService.get('imap.tlsOptions'),
            },
        };
    }
    async saveToDrafts(options) {
        const connection = await imapSimple.connect(this.getImapConfig());
        const draftsFolder = this.configService.get('drafts.folder') || 'Drafts';
        try {
            const mimeMessage = await this.createMimeMessage(options);
            await connection.openBox(draftsFolder);
            await new Promise((resolve, reject) => {
                connection.imap.append(mimeMessage, {
                    mailbox: draftsFolder,
                    flags: ['\\Draft', '\\Seen'],
                }, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            this.logger.log(`📝 Brouillon sauvegardé dans ${draftsFolder}: ${options.subject}`);
            return { success: true };
        }
        catch (error) {
            this.logger.error(`Erreur sauvegarde brouillon: ${error.message}`);
            return { success: false, error: error.message };
        }
        finally {
            connection.end();
        }
    }
    async createMimeMessage(options) {
        const transporter = nodemailer.createTransport({
            streamTransport: true,
            newline: 'windows',
        });
        const fromEmail = this.configService.get('smtp.user') || company_info_1.COMPANY_INFO.contact.primaryEmail;
        const fromName = this.configService.get('smtp.fromName') || `${company_info_1.COMPANY_INFO.contact.name} - ${company_info_1.COMPANY_INFO.name}`;
        const mailOptions = {
            from: `"${fromName}" <${fromEmail}>`,
            to: options.to,
            cc: options.cc?.join(', '),
            bcc: options.bcc?.join(', '),
            subject: options.subject,
            text: options.body,
            html: options.htmlBody || this.textToHtml(options.body),
            attachments: options.attachments?.map(att => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType,
            })),
        };
        const info = await transporter.sendMail(mailOptions);
        const chunks = [];
        return new Promise((resolve, reject) => {
            const stream = info.message;
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
            stream.on('error', reject);
        });
    }
    textToHtml(text) {
        const escapedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; }
    .signature { margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div>${escapedText}</div>
</body>
</html>`;
    }
    async savePriceRequestDraft(generated, options = {}) {
        const { priceRequest, excelBuffer } = generated;
        const to = options.recipientEmail || company_info_1.COMPANY_INFO.contact.primaryEmail;
        const subject = `Demande de Prix N° ${priceRequest.requestNumber}${priceRequest.clientRfqNumber ? ` - Réf. Client: ${priceRequest.clientRfqNumber}` : ''}`;
        let brandAnalysis;
        let bccSuppliers = options.bcc || [];
        try {
            const items = priceRequest.items.map((item) => ({
                description: item.description || '',
                partNumber: item.supplierCode || item.itemCode || '',
                brand: item.brand || '',
            }));
            brandAnalysis = this.brandIntelligence.analyzeRequest(items, `${priceRequest.notes || ''} ${priceRequest.clientName || ''}`);
            this.logger.log(`🏷️ Marques détectées: ${brandAnalysis.detectedBrands.join(', ') || 'aucune'}`);
            if (options.autoAddSuppliers !== false && brandAnalysis.autoSendEmails.length > 0) {
                bccSuppliers = [...new Set([...bccSuppliers, ...brandAnalysis.autoSendEmails])];
                this.logger.log(`📧 ${bccSuppliers.length} fournisseur(s) ajouté(s) en BCC automatiquement`);
            }
            if (brandAnalysis.newBrands.length > 0) {
                await this.brandIntelligence.addNewBrands(brandAnalysis.newBrands);
                this.logger.log(`🆕 ${brandAnalysis.newBrands.length} nouvelle(s) marque(s) ajoutée(s)`);
            }
        }
        catch (error) {
            this.logger.warn(`Erreur analyse marques: ${error.message}`);
        }
        let language = options.language || 'both';
        if (options.autoDetectLanguage && !options.language) {
            language = (0, rfq_instructions_1.detectLanguageFromEmail)(to);
            if (language === 'both' && priceRequest.notes) {
                language = (0, rfq_instructions_1.detectLanguageFromText)(priceRequest.notes);
            }
        }
        const htmlBody = this.generateHtmlEmailBody(priceRequest, language, brandAnalysis);
        const textBody = this.generateTextEmailBody(priceRequest, language);
        const allAttachments = [
            {
                filename: `${priceRequest.requestNumber}.xlsx`,
                content: excelBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        ];
        if (options.additionalAttachments && options.additionalAttachments.length > 0) {
            for (const att of options.additionalAttachments) {
                allAttachments.push({
                    filename: att.filename,
                    content: att.content,
                    contentType: att.contentType,
                });
            }
            this.logger.log(`${options.additionalAttachments.length} pièce(s) jointe(s) supplémentaire(s) incluse(s)`);
        }
        const result = await this.saveToDrafts({
            to,
            cc: options.cc,
            bcc: bccSuppliers.length > 0 ? bccSuppliers : undefined,
            subject,
            body: textBody,
            htmlBody,
            attachments: allAttachments,
        });
        return {
            ...result,
            brandAnalysis,
            bccSuppliers: bccSuppliers.length > 0 ? bccSuppliers : undefined,
        };
    }
    generateHtmlEmailBody(priceRequest, language, brandAnalysis) {
        const responseHours = priceRequest.responseDeadlineHours || 24;
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + responseHours);
        const c = company_info_1.COMPANY_INFO.contact;
        const addr = company_info_1.COMPANY_INFO.address;
        const greeting = language === 'en'
            ? 'Dear Sir or Madam,'
            : language === 'fr'
                ? 'Bonjour,'
                : 'Bonjour / Dear Sir or Madam,';
        const intro = language === 'en'
            ? 'Please find attached a new Request for Quotation.'
            : language === 'fr'
                ? 'Veuillez trouver ci-joint une nouvelle demande de prix.'
                : 'Veuillez trouver ci-joint une nouvelle demande de prix. / Please find attached a new Request for Quotation.';
        const clientInfoRows = [
            priceRequest.clientName ? `<tr><td><strong>${language === 'en' ? 'Client' : 'Client'}:</strong></td><td>${priceRequest.clientName}</td></tr>` : '',
            priceRequest.clientRfqNumber ? `<tr><td><strong>${language === 'en' ? 'Client Ref.' : 'Réf. Client'}:</strong></td><td>${priceRequest.clientRfqNumber}</td></tr>` : '',
            priceRequest.clientEmail ? `<tr><td><strong>${language === 'en' ? 'Client Contact' : 'Contact Client'}:</strong></td><td>${priceRequest.clientEmail}</td></tr>` : '',
            priceRequest.fleetNumber ? `<tr><td><strong>Fleet Number:</strong></td><td>${priceRequest.fleetNumber}</td></tr>` : '',
            priceRequest.serialNumber ? `<tr><td><strong>Serial Number:</strong></td><td>${priceRequest.serialNumber}</td></tr>` : '',
        ].filter(x => x).join('');
        let brandsSection = '';
        if (brandAnalysis && brandAnalysis.detectedBrands.length > 0) {
            const brandsLabel = language === 'en' ? 'Brands' : 'Marques';
            brandsSection = `
    <tr>
      <td><strong>${brandsLabel}:</strong></td>
      <td>${brandAnalysis.detectedBrands.join(', ')}</td>
    </tr>`;
        }
        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h3 { color: #1a5276; }
    .info-box { background: #f8f9fa; border-left: 4px solid #1a5276; padding: 15px; margin: 15px 0; }
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table td { padding: 5px 10px; }
    .signature { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ccc; color: #666; font-size: 12px; }
  </style>
</head>
<body>
<div class="container">

<!-- EN-TÊTE SOCIÉTÉ -->
${(0, company_info_1.getCompanyHeader)()}

<!-- SALUTATION -->
<p>${greeting}</p>
<p>${intro}</p>

<!-- INFORMATIONS DEMANDE -->
<div class="info-box">
  <h3>📋 ${language === 'en' ? 'Request Information' : language === 'fr' ? 'Informations Demande' : 'Informations Demande / Request Information'}</h3>
  <table class="info-table">
    <tr>
      <td><strong>${language === 'en' ? 'Internal Ref.' : 'N° Demande'}:</strong></td>
      <td>${priceRequest.requestNumber}</td>
    </tr>
    <tr>
      <td><strong>Date:</strong></td>
      <td>${priceRequest.date.toLocaleDateString('fr-FR')}</td>
    </tr>
    <tr>
      <td><strong>${language === 'en' ? 'Number of items' : 'Nombre d\'articles'}:</strong></td>
      <td>${priceRequest.items.length}</td>
    </tr>
    <tr>
      <td><strong>${language === 'en' ? 'Response deadline' : 'Délai de réponse'}:</strong></td>
      <td>${responseHours}h (${language === 'en' ? 'before' : 'avant le'} ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</td>
    </tr>
    ${clientInfoRows}
  </table>
</div>

<!-- INSTRUCTIONS RFQ -->
${(0, rfq_instructions_1.getRfqInstructions)(language)}

<!-- ADRESSE DE LIVRAISON -->
<div style="margin: 20px 0; padding: 15px; background: #e8f6f3; border-left: 4px solid #1abc9c;">
  <strong>📍 ${language === 'en' ? 'Delivery Address' : 'Adresse de livraison'}:</strong><br>
  ${company_info_1.COMPANY_INFO.name}<br>
  ${addr.line1}<br>
  ${addr.line2}<br>
  ${addr.city}, ${addr.country}
</div>

${priceRequest.notes ? `
<div style="margin: 20px 0; padding: 15px; background: #fef9e7; border-left: 4px solid #f39c12;">
  <strong>📝 Notes:</strong><br>
  ${priceRequest.notes}
</div>
` : ''}

<!-- SIGNATURE -->
<div class="signature">
  <p>${language === 'en' ? 'Best regards,' : language === 'fr' ? 'Cordialement,' : 'Cordialement / Best regards,'}</p>
  <p>
    <strong>${c.name}</strong><br>
    ${c.title}<br>
    <strong>${company_info_1.COMPANY_INFO.name}</strong><br><br>
    ${addr.line1}<br>
    ${addr.line2}<br>
    ${addr.city}, ${addr.country}<br><br>
    📞 ${c.phone}<br>
    📱 ${c.mobile}<br>
    ✉️ <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
  </p>
</div>

<p style="font-size: 11px; color: #999; margin-top: 30px; text-align: center;">
  ${language === 'en'
            ? 'This message was automatically generated by the MULTIPARTS price request management system.'
            : language === 'fr'
                ? 'Ce message a été généré automatiquement par le système de gestion des demandes de prix MULTIPARTS.'
                : 'Ce message a été généré automatiquement. / This message was automatically generated.'}
</p>

</div>
</body>
</html>`;
    }
    generateTextEmailBody(priceRequest, language) {
        const responseHours = priceRequest.responseDeadlineHours || 24;
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + responseHours);
        const c = company_info_1.COMPANY_INFO.contact;
        const addr = company_info_1.COMPANY_INFO.address;
        const clientInfo = [
            priceRequest.clientName ? `Client: ${priceRequest.clientName}` : '',
            priceRequest.clientRfqNumber ? `Réf. Client: ${priceRequest.clientRfqNumber}` : '',
            priceRequest.clientEmail ? `Contact Client: ${priceRequest.clientEmail}` : '',
            priceRequest.fleetNumber ? `Fleet Number: ${priceRequest.fleetNumber}` : '',
            priceRequest.serialNumber ? `Serial Number: ${priceRequest.serialNumber}` : '',
        ].filter(x => x).join('\n');
        let body = '';
        if (language === 'fr' || language === 'both') {
            body += `═══════════════════════════════════════════════════════
MULTIPARTS CI - DEMANDE DE PRIX
═══════════════════════════════════════════════════════

Bonjour,

Veuillez trouver ci-joint une nouvelle demande de prix.

INFORMATIONS DEMANDE
--------------------
N° Demande: ${priceRequest.requestNumber}
Date: ${priceRequest.date.toLocaleDateString('fr-FR')}
Nombre d'articles: ${priceRequest.items.length}
Délai de réponse: ${responseHours}h (avant le ${deadlineDate.toLocaleDateString('fr-FR')})

${clientInfo ? `INFORMATIONS CLIENT\n--------------------\n${clientInfo}\n` : ''}

INSTRUCTIONS RFQ - MULTIPARTS
=============================
Merci de nous transmettre votre offre avec:

1) PRIX
   - Prix unitaire pour chaque article
   - Prix total de l'offre
   - Devise (EUR / USD / autre)

2) INCOTERM
   - Ex-Works (EXW) ou CIF Abidjan
   - Lieu EXW exact (ville, pays)

3) LOGISTIQUE
   - Poids total (kg)
   - Dimensions et nombre de colis

4) TECHNIQUE
   - Fiche technique / plans
   - Références constructeur exactes
   - Normes et certifications

5) DÉLAIS
   - Délai de livraison
   - Validité de l'offre

6) CONDITIONS COMMERCIALES
   - Conditions de paiement
   - Origine des produits (pays)

ADRESSE DE LIVRAISON
--------------------
${company_info_1.COMPANY_INFO.name}
${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

`;
        }
        if (language === 'both') {
            body += `
═══════════════════════════════════════════════════════
ENGLISH VERSION BELOW
═══════════════════════════════════════════════════════

`;
        }
        if (language === 'en' || language === 'both') {
            body += `═══════════════════════════════════════════════════════
MULTIPARTS CI - REQUEST FOR QUOTATION
═══════════════════════════════════════════════════════

Dear Sir or Madam,

Please find attached a new Request for Quotation.

REQUEST INFORMATION
-------------------
Reference: ${priceRequest.requestNumber}
Date: ${priceRequest.date.toLocaleDateString('en-GB')}
Number of items: ${priceRequest.items.length}
Response deadline: ${responseHours}h (before ${deadlineDate.toLocaleDateString('en-GB')})

RFQ INSTRUCTIONS - MULTIPARTS
=============================
Please provide your offer including:

1) PRICING
   - Unit price for each item
   - Total offer price
   - Currency (EUR / USD / other)

2) INCOTERM
   - Ex-Works (EXW) or CIF Abidjan
   - Exact EXW location (city, country)

3) LOGISTICS
   - Total weight (kg)
   - Dimensions and number of packages

4) TECHNICAL
   - Technical data sheet / drawings
   - Exact manufacturer references
   - Standards and certifications

5) LEAD TIMES
   - Delivery time
   - Offer validity

6) COMMERCIAL TERMS
   - Payment terms
   - Country of origin

DELIVERY ADDRESS
----------------
${company_info_1.COMPANY_INFO.name}
${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

`;
        }
        body += `
---
${c.name}
${c.title}
${company_info_1.COMPANY_INFO.name}
Tel: ${c.phone} | Mobile: ${c.mobile}
Email: ${c.primaryEmail}
`;
        return body;
    }
    async listDrafts(limit = 10) {
        const connection = await imapSimple.connect(this.getImapConfig());
        const draftsFolder = this.configService.get('drafts.folder') || 'Drafts';
        try {
            await connection.openBox(draftsFolder);
            const searchCriteria = ['ALL'];
            const fetchOptions = {
                bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
                struct: true,
            };
            const messages = await connection.search(searchCriteria, fetchOptions);
            const limitedMessages = messages.slice(-limit);
            return limitedMessages.map((msg) => {
                const header = msg.parts.find((p) => p.which.includes('HEADER'));
                return {
                    uid: msg.attributes.uid,
                    date: msg.attributes.date,
                    flags: msg.attributes.flags,
                    header: header?.body,
                };
            });
        }
        finally {
            connection.end();
        }
    }
};
exports.DraftService = DraftService;
exports.DraftService = DraftService = DraftService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => brand_intelligence_service_1.BrandIntelligenceService))),
    __metadata("design:paramtypes", [config_1.ConfigService,
        brand_intelligence_service_1.BrandIntelligenceService])
], DraftService);
//# sourceMappingURL=draft.service.js.map