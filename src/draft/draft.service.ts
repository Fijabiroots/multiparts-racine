import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as imapSimple from 'imap-simple';
import * as nodemailer from 'nodemailer';
import { GeneratedPriceRequest } from '../common/interfaces';
import { COMPANY_INFO, getCompanyHeader, getAddressBlock } from '../common/company-info';
import { RfqLanguage, getRfqInstructions, detectLanguageFromEmail, detectLanguageFromText } from '../common/rfq-instructions';
import { BrandIntelligenceService } from '../brand-intelligence/brand-intelligence.service';
import { BrandAnalysisResult, SupplierSuggestion } from '../brand-intelligence/brand.interface';

interface DraftEmailOptions {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface PriceRequestDraftOptions {
  recipientEmail?: string;
  cc?: string[];                  // Emails en copie
  bcc?: string[];                 // Emails en copie cachée (fournisseurs suggérés)
  language?: RfqLanguage;         // 'fr' | 'en' | 'both'
  autoDetectLanguage?: boolean;   // Détection auto basée sur l'email/contenu
  autoAddSuppliers?: boolean;     // Ajouter automatiquement les fournisseurs suggérés en BCC
  additionalAttachments?: Array<{ 
    filename: string; 
    content: Buffer; 
    contentType: string 
  }>;
}

export interface DraftResult {
  success: boolean;
  messageId?: string;
  error?: string;
  brandAnalysis?: BrandAnalysisResult;
  bccSuppliers?: string[];
}

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => BrandIntelligenceService))
    private brandIntelligence: BrandIntelligenceService,
  ) {}

  private getImapConfig(): imapSimple.ImapSimpleOptions {
    return {
      imap: {
        host: this.configService.get<string>('imap.host'),
        port: this.configService.get<number>('imap.port'),
        user: this.configService.get<string>('imap.user'),
        password: this.configService.get<string>('imap.password'),
        tls: this.configService.get<boolean>('imap.tls'),
        authTimeout: this.configService.get<number>('imap.authTimeout'),
        tlsOptions: this.configService.get('imap.tlsOptions'),
      },
    };
  }

  async saveToDrafts(options: DraftEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const connection = await imapSimple.connect(this.getImapConfig());
    const draftsFolder = this.configService.get<string>('drafts.folder') || 'Drafts';

    try {
      const mimeMessage = await this.createMimeMessage(options);
      await connection.openBox(draftsFolder);

      await new Promise<void>((resolve, reject) => {
        (connection as any).imap.append(
          mimeMessage,
          {
            mailbox: draftsFolder,
            flags: ['\\Draft', '\\Seen'],
          },
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      this.logger.log(`📝 Brouillon sauvegardé dans ${draftsFolder}: ${options.subject}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Erreur sauvegarde brouillon: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      connection.end();
    }
  }

  private async createMimeMessage(options: DraftEmailOptions): Promise<string> {
    const transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'windows',
    });

    const fromEmail = this.configService.get<string>('smtp.user') || COMPANY_INFO.contact.primaryEmail;
    const fromName = this.configService.get<string>('smtp.fromName') || `${COMPANY_INFO.contact.name} - ${COMPANY_INFO.name}`;

    const mailOptions: nodemailer.SendMailOptions = {
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
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      const stream = info.message as NodeJS.ReadableStream;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });
  }

  private textToHtml(text: string): string {
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

  /**
   * Sauvegarder une demande de prix en brouillon avec instructions RFQ
   * et suggestions de fournisseurs basées sur les marques détectées
   */
  async savePriceRequestDraft(
    generated: GeneratedPriceRequest,
    options: PriceRequestDraftOptions = {},
  ): Promise<DraftResult> {
    const { priceRequest, excelBuffer } = generated;

    const to = options.recipientEmail || COMPANY_INFO.contact.primaryEmail;
    const subject = `Demande de Prix N° ${priceRequest.requestNumber}${priceRequest.clientRfqNumber ? ` - Réf. Client: ${priceRequest.clientRfqNumber}` : ''}`;

    // ═══════════════════════════════════════════════════════════════════════
    // ANALYSE DES MARQUES ET SUGGESTIONS FOURNISSEURS
    // ═══════════════════════════════════════════════════════════════════════
    let brandAnalysis: BrandAnalysisResult | undefined;
    let bccSuppliers: string[] = options.bcc || [];
    
    try {
      // Analyser les items pour détecter les marques
      const items = priceRequest.items.map((item: any) => ({
        description: item.description || '',
        partNumber: item.supplierCode || item.itemCode || '',
        brand: item.brand || '',
      }));
      
      brandAnalysis = this.brandIntelligence.analyzeRequest(
        items,
        `${priceRequest.notes || ''} ${priceRequest.clientName || ''}`
      );

      this.logger.log(`🏷️ Marques détectées: ${brandAnalysis.detectedBrands.join(', ') || 'aucune'}`);
      
      // Ajouter automatiquement les fournisseurs suggérés en BCC
      if (options.autoAddSuppliers !== false && brandAnalysis.autoSendEmails.length > 0) {
        bccSuppliers = [...new Set([...bccSuppliers, ...brandAnalysis.autoSendEmails])];
        this.logger.log(`📧 ${bccSuppliers.length} fournisseur(s) ajouté(s) en BCC automatiquement`);
      }

      // Ajouter les nouvelles marques détectées
      if (brandAnalysis.newBrands.length > 0) {
        await this.brandIntelligence.addNewBrands(brandAnalysis.newBrands);
        this.logger.log(`🆕 ${brandAnalysis.newBrands.length} nouvelle(s) marque(s) ajoutée(s)`);
      }
    } catch (error) {
      this.logger.warn(`Erreur analyse marques: ${error.message}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DÉTERMINER LA LANGUE
    // ═══════════════════════════════════════════════════════════════════════
    let language: RfqLanguage = options.language || 'both';
    if (options.autoDetectLanguage && !options.language) {
      language = detectLanguageFromEmail(to);
      if (language === 'both' && priceRequest.notes) {
        language = detectLanguageFromText(priceRequest.notes);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GÉNÉRER LE CONTENU
    // ═══════════════════════════════════════════════════════════════════════
    const htmlBody = this.generateHtmlEmailBody(priceRequest, language, brandAnalysis);
    const textBody = this.generateTextEmailBody(priceRequest, language);

    // Préparer les pièces jointes
    const allAttachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [
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

    // ═══════════════════════════════════════════════════════════════════════
    // SAUVEGARDER LE BROUILLON
    // ═══════════════════════════════════════════════════════════════════════
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

  /**
   * Générer le corps HTML de l'email avec en-tête société et instructions RFQ
   */
  private generateHtmlEmailBody(priceRequest: any, language: RfqLanguage, brandAnalysis?: BrandAnalysisResult): string {
    const responseHours = priceRequest.responseDeadlineHours || 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);

    const c = COMPANY_INFO.contact;
    const addr = COMPANY_INFO.address;

    // Salutation selon la langue
    const greeting = language === 'en' 
      ? 'Dear Sir or Madam,' 
      : language === 'fr' 
        ? 'Bonjour,' 
        : 'Bonjour / Dear Sir or Madam,';

    // Introduction
    const intro = language === 'en'
      ? 'Please find attached a new Request for Quotation.'
      : language === 'fr'
        ? 'Veuillez trouver ci-joint une nouvelle demande de prix.'
        : 'Veuillez trouver ci-joint une nouvelle demande de prix. / Please find attached a new Request for Quotation.';

    // Informations client
    const clientInfoRows = [
      priceRequest.clientName ? `<tr><td><strong>${language === 'en' ? 'Client' : 'Client'}:</strong></td><td>${priceRequest.clientName}</td></tr>` : '',
      priceRequest.clientRfqNumber ? `<tr><td><strong>${language === 'en' ? 'Client Ref.' : 'Réf. Client'}:</strong></td><td>${priceRequest.clientRfqNumber}</td></tr>` : '',
      priceRequest.clientEmail ? `<tr><td><strong>${language === 'en' ? 'Client Contact' : 'Contact Client'}:</strong></td><td>${priceRequest.clientEmail}</td></tr>` : '',
      priceRequest.fleetNumber ? `<tr><td><strong>Fleet Number:</strong></td><td>${priceRequest.fleetNumber}</td></tr>` : '',
      priceRequest.serialNumber ? `<tr><td><strong>Serial Number:</strong></td><td>${priceRequest.serialNumber}</td></tr>` : '',
    ].filter(x => x).join('');

    // Section marques détectées (visible uniquement en interne, pas envoyé aux fournisseurs)
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
${getCompanyHeader()}

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
${getRfqInstructions(language)}

<!-- ADRESSE DE LIVRAISON -->
<div style="margin: 20px 0; padding: 15px; background: #e8f6f3; border-left: 4px solid #1abc9c;">
  <strong>📍 ${language === 'en' ? 'Delivery Address' : 'Adresse de livraison'}:</strong><br>
  ${COMPANY_INFO.name}<br>
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
    <strong>${COMPANY_INFO.name}</strong><br><br>
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

  /**
   * Version texte brut pour compatibilité
   */
  private generateTextEmailBody(priceRequest: any, language: RfqLanguage): string {
    const responseHours = priceRequest.responseDeadlineHours || 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);

    const c = COMPANY_INFO.contact;
    const addr = COMPANY_INFO.address;

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
${COMPANY_INFO.name}
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
${COMPANY_INFO.name}
${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

`;
    }

    body += `
---
${c.name}
${c.title}
${COMPANY_INFO.name}
Tel: ${c.phone} | Mobile: ${c.mobile}
Email: ${c.primaryEmail}
`;

    return body;
  }

  async listDrafts(limit = 10): Promise<any[]> {
    const connection = await imapSimple.connect(this.getImapConfig());
    const draftsFolder = this.configService.get<string>('drafts.folder') || 'Drafts';

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
        const header = msg.parts.find((p: any) => p.which.includes('HEADER'));
        return {
          uid: msg.attributes.uid,
          date: msg.attributes.date,
          flags: msg.attributes.flags,
          header: header?.body,
        };
      });
    } finally {
      connection.end();
    }
  }
}
