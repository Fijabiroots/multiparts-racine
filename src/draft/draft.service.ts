import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as imapSimple from 'imap-simple';
import * as nodemailer from 'nodemailer';
import { GeneratedPriceRequest } from '../common/interfaces';
import { COMPANY_INFO, getCompanyHeader, getAddressBlock } from '../common/company-info';
import { RfqLanguage, getRfqInstructions, detectLanguageFromEmail, detectLanguageFromText } from '../common/rfq-instructions';
import { BrandIntelligenceService } from '../brand-intelligence/brand-intelligence.service';
import { BrandAnalysisResult, SupplierSuggestion } from '../brand-intelligence/brand.interface';
import { SupplierDirectoryService } from '../supplier-collector/services/supplier-directory.service';

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
    @Optional()
    private supplierDirectory?: SupplierDirectoryService,
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
    const draftsFolder = this.configService.get<string>('drafts.folder') || 'Drafts';
    return this.saveToFolder(options, draftsFolder, ['\\Draft', '\\Seen']);
  }

  /**
   * Sauvegarder un email dans un dossier IMAP spécifique
   * @param options Options de l'email
   * @param folder Nom du dossier IMAP (ex: 'Notifications RFQ', 'Drafts')
   * @param flags Flags IMAP à appliquer (ex: ['\\Seen'], ['\\Draft', '\\Seen'])
   */
  async saveToFolder(
    options: DraftEmailOptions,
    folder: string,
    flags: string[] = ['\\Seen'],
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const connection = await imapSimple.connect(this.getImapConfig());

    try {
      const mimeMessage = await this.createMimeMessage(options);

      // Essayer d'ouvrir le dossier, le créer s'il n'existe pas
      try {
        await connection.openBox(folder);
      } catch (err) {
        // Créer le dossier s'il n'existe pas
        this.logger.log(`Création du dossier IMAP: ${folder}`);
        await new Promise<void>((resolve, reject) => {
          (connection as any).imap.addBox(folder, (error: Error | null) => {
            if (error) reject(error);
            else resolve();
          });
        });
        await connection.openBox(folder);
      }

      await new Promise<void>((resolve, reject) => {
        (connection as any).imap.append(
          mimeMessage,
          {
            mailbox: folder,
            flags,
          },
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      this.logger.log(`📝 Email sauvegardé dans ${folder}: ${options.subject}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Erreur sauvegarde dans ${folder}: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      connection.end();
    }
  }

  /**
   * Envoyer une notification RFQ à rafiou.oyeossi@ dans le dossier "Notifications RFQ"
   * Utilisé quand un email arrive uniquement sur procurement@
   */
  async sendRfqNotification(options: {
    originalEmail: {
      from: string;
      subject: string;
      date: Date;
      body: string;
      attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
    };
    clientName?: string;
    clientEmail: string;
    clientRequirements?: {
      responseDeadline?: string;
      replyToEmail?: string;
      urgent?: boolean;
    };
  }): Promise<{ success: boolean; error?: string }> {
    const notificationFolder = 'Notifications RFQ';

    // Générer le corps de la notification
    const { htmlBody, textBody } = this.generateNotificationContent(options);

    // Inclure l'email original et ses pièces jointes
    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];

    // Ajouter les pièces jointes originales
    if (options.originalEmail.attachments) {
      for (const att of options.originalEmail.attachments) {
        attachments.push(att);
      }
    }

    return this.saveToFolder(
      {
        to: 'rafiou.oyeossi@multipartsci.com',
        subject: `[NOTIFICATION RFQ] ${options.originalEmail.subject}`,
        body: textBody,
        htmlBody,
        attachments,
      },
      notificationFolder,
      ['\\Seen'],
    );
  }

  /**
   * Générer le contenu de la notification RFQ
   */
  private generateNotificationContent(options: {
    originalEmail: {
      from: string;
      subject: string;
      date: Date;
      body: string;
    };
    clientName?: string;
    clientEmail: string;
    clientRequirements?: {
      responseDeadline?: string;
      replyToEmail?: string;
      urgent?: boolean;
    };
  }): { htmlBody: string; textBody: string } {
    const { originalEmail, clientName, clientEmail, clientRequirements } = options;
    const hasRequirements = clientRequirements && (clientRequirements.responseDeadline || clientRequirements.replyToEmail);

    const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
    .alert { color: #c0392b; font-weight: bold; }
    .info-box { background: #f8f9fa; border-left: 4px solid #3498db; padding: 15px; margin: 15px 0; }
    .requirements-box { background: #fef9e7; border-left: 4px solid #e74c3c; padding: 15px; margin: 15px 0; }
    .original-email { background: #ecf0f1; padding: 15px; margin: 20px 0; border-radius: 5px; }
  </style>
</head>
<body>

<h2>📬 Nouvelle demande reçue sur procurement@</h2>

<p>Une nouvelle demande de prix a été reçue <strong>uniquement</strong> sur l'adresse procurement@multipartsci.com.</p>

<div class="info-box">
  <h3>📋 Informations Client</h3>
  <table>
    <tr><td><strong>De:</strong></td><td>${originalEmail.from}</td></tr>
    <tr><td><strong>Client:</strong></td><td>${clientName || 'Non identifié'}</td></tr>
    <tr><td><strong>Email:</strong></td><td>${clientEmail}</td></tr>
    <tr><td><strong>Date:</strong></td><td>${originalEmail.date.toLocaleDateString('fr-FR')} ${originalEmail.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td></tr>
    <tr><td><strong>Sujet:</strong></td><td>${originalEmail.subject}</td></tr>
  </table>
</div>

${hasRequirements ? `
<div class="requirements-box">
  <h3 class="alert">⚠️ EXIGENCES CLIENT</h3>
  <table>
    ${clientRequirements?.responseDeadline ? `<tr><td><strong class="alert">Délai de réponse exigé:</strong></td><td class="alert">${clientRequirements.responseDeadline}</td></tr>` : ''}
    ${clientRequirements?.replyToEmail ? `<tr><td><strong class="alert">Adresse de réponse:</strong></td><td class="alert">${clientRequirements.replyToEmail}</td></tr>` : ''}
    ${clientRequirements?.urgent ? `<tr><td colspan="2" class="alert">⚡ DEMANDE URGENTE</td></tr>` : ''}
  </table>
</div>
` : ''}

<div class="original-email">
  <h3>📧 Message original</h3>
  <pre style="white-space: pre-wrap; font-family: inherit;">${originalEmail.body.substring(0, 2000)}${originalEmail.body.length > 2000 ? '\n\n[...tronqué...]' : ''}</pre>
</div>

<p style="font-size: 12px; color: #666; margin-top: 30px;">
  Les pièces jointes originales sont incluses avec cette notification.<br>
  <em>Notification générée automatiquement par le système RFQ.</em>
</p>

</body>
</html>`;

    const textBody = `NOTIFICATION RFQ - Nouvelle demande sur procurement@
========================================================

Une nouvelle demande de prix a été reçue UNIQUEMENT sur procurement@multipartsci.com.

INFORMATIONS CLIENT
-------------------
De: ${originalEmail.from}
Client: ${clientName || 'Non identifié'}
Email: ${clientEmail}
Date: ${originalEmail.date.toLocaleDateString('fr-FR')} ${originalEmail.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
Sujet: ${originalEmail.subject}

${hasRequirements ? `
⚠️ EXIGENCES CLIENT ⚠️
----------------------
${clientRequirements?.responseDeadline ? `Délai de réponse exigé: ${clientRequirements.responseDeadline}` : ''}
${clientRequirements?.replyToEmail ? `Adresse de réponse: ${clientRequirements.replyToEmail}` : ''}
${clientRequirements?.urgent ? `⚡ DEMANDE URGENTE` : ''}
` : ''}

MESSAGE ORIGINAL
----------------
${originalEmail.body.substring(0, 2000)}${originalEmail.body.length > 2000 ? '\n\n[...tronqué...]' : ''}

---
Les pièces jointes originales sont incluses avec cette notification.
Notification générée automatiquement par le système RFQ.`;

    return { htmlBody, textBody };
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
      
      // Ajouter automatiquement les fournisseurs suggérés en BCC (depuis BrandIntelligence)
      if (options.autoAddSuppliers !== false && brandAnalysis.autoSendEmails.length > 0) {
        bccSuppliers = [...new Set([...bccSuppliers, ...brandAnalysis.autoSendEmails])];
        this.logger.log(`📧 ${bccSuppliers.length} fournisseur(s) ajouté(s) en BCC (BrandIntelligence)`);
      }

      // Ajouter les fournisseurs collectés dynamiquement (depuis SupplierDirectory)
      if (options.autoAddSuppliers !== false && this.supplierDirectory && brandAnalysis.detectedBrands.length > 0) {
        try {
          const collectedEmails = await this.supplierDirectory.getUniqueSupplierEmailsForBrands(
            brandAnalysis.detectedBrands
          );
          if (collectedEmails.length > 0) {
            const beforeCount = bccSuppliers.length;
            bccSuppliers = [...new Set([...bccSuppliers, ...collectedEmails])];
            const addedCount = bccSuppliers.length - beforeCount;
            if (addedCount > 0) {
              this.logger.log(`📧 ${addedCount} fournisseur(s) ajouté(s) en BCC (SupplierCollector)`);
            }
          }
        } catch (err) {
          this.logger.warn(`Erreur récupération fournisseurs collectés: ${err.message}`);
        }
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
    // FORCER LE MODE BILINGUE (Français ET Anglais toujours)
    // ═══════════════════════════════════════════════════════════════════════
    const language: RfqLanguage = 'both'; // Toujours bilingue

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

    // Toujours bilingue maintenant
    const greeting = 'Bonjour / Dear Sir or Madam,';
    const intro = 'Veuillez trouver ci-joint une nouvelle demande de prix. / Please find attached a new Request for Quotation.';

    // Informations client
    const clientInfoRows = [
      priceRequest.clientName ? `<tr><td><strong>Client:</strong></td><td>${priceRequest.clientName}</td></tr>` : '',
      priceRequest.clientRfqNumber ? `<tr><td><strong>Réf. Client / Client Ref.:</strong></td><td>${priceRequest.clientRfqNumber}</td></tr>` : '',
      priceRequest.clientEmail ? `<tr><td><strong>Contact Client / Client Contact:</strong></td><td>${priceRequest.clientEmail}</td></tr>` : '',
      priceRequest.fleetNumber ? `<tr><td><strong>Fleet Number:</strong></td><td>${priceRequest.fleetNumber}</td></tr>` : '',
      priceRequest.serialNumber ? `<tr><td><strong>Serial Number:</strong></td><td>${priceRequest.serialNumber}</td></tr>` : '',
    ].filter(x => x).join('');

    // Section marques détectées
    let brandsSection = '';
    if (brandAnalysis && brandAnalysis.detectedBrands.length > 0) {
      brandsSection = `
    <tr>
      <td><strong>Marques / Brands:</strong></td>
      <td>${brandAnalysis.detectedBrands.join(', ')}</td>
    </tr>`;
    }

    // Section exigences client (EN ROUGE si présentes)
    let clientRequirementsSection = '';
    if (priceRequest.clientRequirements) {
      const reqs = priceRequest.clientRequirements;
      const hasRequirements = reqs.responseDeadline || reqs.replyToEmail || reqs.urgent;

      if (hasRequirements) {
        clientRequirementsSection = `
<div style="background: #fef2f2; border-left: 4px solid #e74c3c; padding: 15px; margin: 15px 0;">
  <h3 style="color: #c0392b; margin-top: 0;">⚠️ EXIGENCES CLIENT / CLIENT REQUIREMENTS</h3>
  <table class="info-table">
    ${reqs.urgent ? `<tr><td colspan="2" style="color: #c0392b; font-weight: bold; font-size: 16px;">⚡ DEMANDE URGENTE / URGENT REQUEST</td></tr>` : ''}
    ${reqs.responseDeadline ? `<tr>
      <td style="color: #c0392b; font-weight: bold;">Délai de réponse exigé / Required Response Time:</td>
      <td style="color: #c0392b; font-weight: bold; font-size: 16px;">${reqs.responseDeadline}</td>
    </tr>` : ''}
    ${reqs.replyToEmail ? `<tr>
      <td style="color: #c0392b; font-weight: bold;">Adresse de réponse / Reply To:</td>
      <td style="color: #c0392b; font-weight: bold;">${reqs.replyToEmail}</td>
    </tr>` : ''}
    ${reqs.otherRequirements?.length ? `<tr>
      <td style="color: #c0392b; font-weight: bold;">Autres exigences / Other Requirements:</td>
      <td style="color: #c0392b;">${reqs.otherRequirements.join(', ')}</td>
    </tr>` : ''}
  </table>
</div>`;
      }
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

<!-- EXIGENCES CLIENT (en rouge si présentes) -->
${clientRequirementsSection}

<!-- INFORMATIONS DEMANDE -->
<div class="info-box">
  <h3>📋 Informations Demande / Request Information</h3>
  <table class="info-table">
    <tr>
      <td><strong>N° Demande / Internal Ref.:</strong></td>
      <td>${priceRequest.requestNumber}</td>
    </tr>
    <tr>
      <td><strong>Date:</strong></td>
      <td>${priceRequest.date.toLocaleDateString('fr-FR')}</td>
    </tr>
    ${priceRequest.sourceEmail?.date ? `
    <tr>
      <td><strong>Réception demande client / Client Request Received:</strong></td>
      <td>${new Date(priceRequest.sourceEmail.date).toLocaleDateString('fr-FR')} ${new Date(priceRequest.sourceEmail.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
    </tr>` : ''}
    <tr>
      <td><strong>Nombre d'articles / Number of items:</strong></td>
      <td>${priceRequest.items.length}</td>
    </tr>
    <tr>
      <td><strong>Délai de réponse / Response deadline:</strong></td>
      <td>${responseHours}h (avant le / before ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</td>
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
   * Version texte brut pour compatibilité - toujours bilingue
   */
  private generateTextEmailBody(priceRequest: any, language: RfqLanguage): string {
    const responseHours = priceRequest.responseDeadlineHours || 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);

    const c = COMPANY_INFO.contact;
    const addr = COMPANY_INFO.address;

    const clientInfo = [
      priceRequest.clientName ? `Client: ${priceRequest.clientName}` : '',
      priceRequest.clientRfqNumber ? `Réf. Client / Client Ref.: ${priceRequest.clientRfqNumber}` : '',
      priceRequest.clientEmail ? `Contact Client / Client Contact: ${priceRequest.clientEmail}` : '',
      priceRequest.fleetNumber ? `Fleet Number: ${priceRequest.fleetNumber}` : '',
      priceRequest.serialNumber ? `Serial Number: ${priceRequest.serialNumber}` : '',
    ].filter(x => x).join('\n');

    // Section exigences client (si présentes)
    let clientRequirementsSection = '';
    if (priceRequest.clientRequirements) {
      const reqs = priceRequest.clientRequirements;
      const hasReqs = reqs.responseDeadline || reqs.replyToEmail || reqs.urgent;

      if (hasReqs) {
        const parts: string[] = [];
        if (reqs.urgent) parts.push('⚡ DEMANDE URGENTE / URGENT REQUEST');
        if (reqs.responseDeadline) parts.push(`Délai de réponse exigé / Required Response Time: ${reqs.responseDeadline}`);
        if (reqs.replyToEmail) parts.push(`Adresse de réponse / Reply To: ${reqs.replyToEmail}`);
        if (reqs.otherRequirements?.length) parts.push(`Autres exigences / Other: ${reqs.otherRequirements.join(', ')}`);

        clientRequirementsSection = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
⚠️ EXIGENCES CLIENT / CLIENT REQUIREMENTS ⚠️
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
${parts.join('\n')}
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

`;
      }
    }

    // Toujours bilingue (Français ET Anglais)
    const body = `═══════════════════════════════════════════════════════
MULTIPARTS CI - DEMANDE DE PRIX / PRICE REQUEST
═══════════════════════════════════════════════════════

Bonjour / Dear Sir or Madam,

Veuillez trouver ci-joint une nouvelle demande de prix.
Please find attached a new Request for Quotation.

${clientRequirementsSection}INFORMATIONS DEMANDE / REQUEST INFORMATION
-------------------------------------------
N° Demande / Internal Ref.: ${priceRequest.requestNumber}
Date: ${priceRequest.date.toLocaleDateString('fr-FR')}
${priceRequest.sourceEmail?.date ? `Réception demande client / Client Request Received: ${new Date(priceRequest.sourceEmail.date).toLocaleDateString('fr-FR')} ${new Date(priceRequest.sourceEmail.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` : ''}Nombre d'articles / Number of items: ${priceRequest.items.length}
Délai de réponse / Response deadline: ${responseHours}h (avant le / before ${deadlineDate.toLocaleDateString('fr-FR')})

${clientInfo ? `INFORMATIONS CLIENT / CLIENT INFORMATION\n-----------------------------------------\n${clientInfo}\n` : ''}
INSTRUCTIONS RFQ - MULTIPARTS
=============================

FRANÇAIS:
---------
Merci de nous transmettre votre offre avec:
1) PRIX - Prix unitaire, Prix total, Devise (EUR/USD)
2) INCOTERM - Ex-Works (EXW) ou CIF Abidjan
3) LOGISTIQUE - Poids total (kg), Dimensions et nombre de colis
4) TECHNIQUE - Fiche technique, Références constructeur, Normes
5) DÉLAIS - Délai de livraison, Validité de l'offre
6) CONDITIONS - Conditions de paiement, Origine des produits

ENGLISH:
--------
Please provide your offer including:
1) PRICING - Unit price, Total price, Currency (EUR/USD)
2) INCOTERM - Ex-Works (EXW) or CIF Abidjan
3) LOGISTICS - Total weight (kg), Dimensions and packages
4) TECHNICAL - Data sheet, Manufacturer references, Standards
5) LEAD TIMES - Delivery time, Offer validity
6) TERMS - Payment terms, Country of origin

ADRESSE DE LIVRAISON / DELIVERY ADDRESS
---------------------------------------
${COMPANY_INFO.name}
${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

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
