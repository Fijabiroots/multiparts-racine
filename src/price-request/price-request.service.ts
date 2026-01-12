import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { PdfService } from '../pdf/pdf.service';
import { ExcelService } from '../excel/excel.service';
import { DraftService } from '../draft/draft.service';
import { AcknowledgmentService } from '../acknowledgment/acknowledgment.service';
import { TrackingService } from '../tracking/tracking.service';
import { WebhookService } from '../webhook/webhook.service';
import { DocumentExtractionService, CanonicalAdapterService } from '../llm';
import {
  ParsedEmail,
  PriceRequest,
  PriceRequestItem,
  ExtractedPdfData,
  GeneratedPriceRequest,
} from '../common/interfaces';

interface ProcessEmailResult {
  success: boolean;
  email?: ParsedEmail;
  extractedData?: ExtractedPdfData[];
  priceRequest?: PriceRequest;
  generatedExcel?: GeneratedPriceRequest;
  draftSaved?: boolean;
  acknowledgmentSent?: boolean;
  tracked?: boolean;
  error?: string;
}

interface ProcessAllResult {
  processed: number;
  successful: number;
  failed: number;
  results: ProcessEmailResult[];
}

@Injectable()
export class PriceRequestService {
  private readonly logger = new Logger(PriceRequestService.name);
  private readonly DEFAULT_RECIPIENT = 'procurement@multipartsci.com';
  private readonly DEFAULT_RESPONSE_HOURS = 24;

  // LLM configuration
  private readonly llmMode: string;
  private readonly llmMinItemsThreshold: number;
  private readonly llmMinConfidenceThreshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly pdfService: PdfService,
    private readonly excelService: ExcelService,
    private readonly draftService: DraftService,
    private readonly acknowledgmentService: AcknowledgmentService,
    private readonly trackingService: TrackingService,
    private readonly webhookService: WebhookService,
    @Optional() private readonly llmExtraction?: DocumentExtractionService,
    @Optional() private readonly canonicalAdapter?: CanonicalAdapterService,
  ) {
    this.llmMode = this.configService.get<string>('LLM_MODE', 'off');
    this.llmMinItemsThreshold = this.configService.get<number>('LLM_MIN_ITEMS_THRESHOLD', 3);
    this.llmMinConfidenceThreshold = this.configService.get<number>('LLM_MIN_CONFIDENCE_THRESHOLD', 60);
    this.logger.log(`LLM Mode: ${this.llmMode}`);
  }

  async processEmailById(emailId: string, folder = 'INBOX', supplierEmail?: string): Promise<ProcessEmailResult> {
    try {
      // 1. Récupérer l'email
      const email = await this.emailService.fetchEmailById(emailId, folder);
      if (!email) {
        return { success: false, error: 'Email non trouvé' };
      }

      return this.processEmail(email, supplierEmail);
    } catch (error) {
      this.logger.error(`Erreur traitement email ${emailId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async processEmail(email: ParsedEmail, supplierEmail?: string): Promise<ProcessEmailResult> {
    try {
      // Vérifier si c'est une offre fournisseur (pas une demande de prix)
      const quoteCheck = this.isLikelySupplierQuote(email);
      if (quoteCheck.isQuote) {
        this.logger.warn(`Email filtré comme offre fournisseur: ${quoteCheck.reason}`);
        return {
          success: false,
          email,
          error: `Offre fournisseur détectée (pas une demande de prix): ${quoteCheck.reason}`,
        };
      }

      // Séparer les pièces jointes par type
      const pdfAttachments = email.attachments.filter(
        (att) => att.contentType === 'application/pdf' || att.filename?.toLowerCase().endsWith('.pdf'),
      );
      
      // Pièces jointes complémentaires (images, etc.) à inclure dans le brouillon
      const additionalAttachments = email.attachments.filter(
        (att) => {
          const lowerType = att.contentType.toLowerCase();
          const lowerName = att.filename?.toLowerCase() || '';

          // =====================================================
          // Filtrer les images de signature/inline Outlook
          // Ces images polluent les fichiers Excel avec des entrées inutiles
          // Patterns connus: outlook-xxx.png, image001.png, cid:xxx, etc.
          // =====================================================

          // Pattern 1: Images contenant "outlook" n'importe où dans le nom
          if (/outlook/i.test(lowerName)) {
            return false;
          }

          // Pattern 1b: Images contenant "logo" (souvent signatures d'entreprise)
          if (/logo/i.test(lowerName) && lowerType.includes('image')) {
            return false;
          }

          // Pattern 1c: Fichiers se terminant par "Desc.png/jpg" (ex: LogoDesc.png)
          if (/desc\.(png|jpg|jpeg|gif)$/i.test(lowerName)) {
            return false;
          }

          // Pattern 2: Images génériques inline (image001.png, image002.jpg)
          if (/^image\d+\./i.test(lowerName)) {
            return false;
          }

          // Pattern 3: CID (Content-ID) references
          if (/^cid:/i.test(lowerName) || /^cid[-_]/i.test(lowerName)) {
            return false;
          }

          // Pattern 4: Images de signature courantes (signature.png, logo.png, footer.png)
          if (/^(signature|logo|footer|banner|header)[-_\d]*\./i.test(lowerName)) {
            return false;
          }

          // Pattern 5: Images avec ID hexadécimaux (souvent générées automatiquement)
          // Ex: "a1b2c3d4-e5f6-7890.png" ou "~WRL0001.tmp"
          if (/^[a-f0-9]{8,}[-_]/i.test(lowerName) || /^~[A-Z]{3}\d+/i.test(lowerName)) {
            return false;
          }

          // Pattern 6: Images inline Microsoft (ATT00001.png, winmail.dat content)
          if (/^att\d+\./i.test(lowerName) || lowerName === 'winmail.dat') {
            return false;
          }

          // Pattern 7: Très petites images (probablement icônes/spacers) - vérifier si disponible
          // Si la taille est disponible et < 5KB, probablement une icône
          if (att.size && att.size < 5000 && lowerType.includes('image')) {
            return false;
          }

          // Accepter les vraies pièces jointes utiles
          return lowerType.includes('image') ||
                 /\.(jpg|jpeg|png|gif|bmp|webp|tiff?)$/i.test(lowerName) ||
                 /\.(doc|docx|xls|xlsx)$/i.test(lowerName);
        },
      );

      let extractedData: ExtractedPdfData[] = [];
      let itemsFromBody: PriceRequestItem[] = [];

      // CAS 1: PDF présent - extraire les données
      if (pdfAttachments.length > 0) {
        extractedData = await this.pdfService.extractFromAttachments(pdfAttachments);
      }

      // CAS 2: Pas de PDF ou extraction échouée - essayer le corps de l'email
      if (extractedData.length === 0 || extractedData.every(d => d.items.length === 0)) {
        this.logger.log('Pas de PDF ou extraction vide, tentative depuis le corps de l\'email');
        itemsFromBody = this.pdfService.extractItemsFromEmailBody(email.body);
        
        if (itemsFromBody.length > 0) {
          // Créer un "ExtractedPdfData" virtuel depuis le corps de l'email
          extractedData = [{
            filename: 'email_body',
            text: email.body,
            items: itemsFromBody,
            rfqNumber: this.extractRfqFromSubject(email.subject),
          }];
          this.logger.log(`${itemsFromBody.length} items extraits du corps de l'email`);
        }
      }

      // Si toujours rien, retourner une erreur
      if (extractedData.length === 0 || extractedData.every(d => d.items.length === 0)) {
        return {
          success: false,
          email,
          error: 'Aucune demande détectée (ni dans les PDF, ni dans le corps de l\'email)'
        };
      }

      // LLM Fallback: Améliorer l'extraction si LLM activé
      const allRegexItems = extractedData.flatMap(d => d.items);
      const shouldUseLlm = this.shouldTriggerLlmFallback(allRegexItems);

      if (shouldUseLlm && this.llmExtraction && this.canonicalAdapter) {
        this.logger.log(`LLM Fallback triggered: ${allRegexItems.length} items from regex, mode=${this.llmMode}`);

        try {
          const llmInputs = pdfAttachments.map(att => ({
            content: att.content,
            filename: att.filename,
            mimeType: att.contentType,
          }));

          const llmResult = await this.llmExtraction.extractAndMerge(llmInputs);
          const llmItems = this.canonicalAdapter.toPriceRequestItems(llmResult);

          // En mode 'always', utiliser LLM si résultats valides
          // Sinon, utiliser LLM seulement s'il extrait plus d'items
          const shouldUseLlmResults =
            this.llmMode === 'always'
              ? llmItems.length > 0
              : llmItems.length > allRegexItems.length;

          if (shouldUseLlmResults) {
            this.logger.log(`LLM extracted ${llmItems.length} items (vs ${allRegexItems.length} from regex), using LLM results`);

            // Remplacer les items dans extractedData
            extractedData = [{
              filename: extractedData[0]?.filename || 'llm_extraction',
              text: extractedData[0]?.text || '',
              items: llmItems,
              rfqNumber: llmResult.document_number !== 'UNKNOWN' ? llmResult.document_number : extractedData[0]?.rfqNumber,
              generalDescription: llmResult.general_description,
              needsVerification: llmResult._meta.confidence_score < this.llmMinConfidenceThreshold,
            }];
          } else {
            this.logger.debug(`LLM results not used: ${llmItems.length} LLM items vs ${allRegexItems.length} regex items`);
          }
        } catch (llmError) {
          this.logger.error(`LLM extraction failed: ${llmError}`);
          // Continue with regex results
        }
      }

      // 3. Construire la demande de prix
      const priceRequest = this.buildPriceRequest(email, extractedData, supplierEmail);
      
      // Ajouter les pièces jointes complémentaires
      if (additionalAttachments.length > 0) {
        priceRequest.additionalAttachments = additionalAttachments;
        this.logger.log(`${additionalAttachments.length} pièce(s) jointe(s) complémentaire(s) ajoutée(s)`);
      }

      // 4. Générer le fichier Excel
      const generatedExcel = await this.excelService.generatePriceRequestExcel(priceRequest);

      // 5. Sauvegarder dans les brouillons avec instructions RFQ
      const draftResult = await this.draftService.savePriceRequestDraft(
        generatedExcel,
        {
          recipientEmail: this.DEFAULT_RECIPIENT, // procurement@multipartsci.com
          autoDetectLanguage: true,               // Détection auto de la langue
          additionalAttachments,                  // Images et documents
        }
      );

      // 6. Envoyer l'accusé de réception au client
      let acknowledgmentSent = false;
      const sendAck = this.configService.get<boolean>('email.sendAcknowledgment', true);
      
      if (sendAck) {
        acknowledgmentSent = await this.sendAcknowledgmentToClient(email, priceRequest, extractedData);
      }

      // 7. Enregistrer dans le fichier de suivi
      let tracked = false;
      try {
        // Extraire le deadline
        let deadline: string | undefined;
        for (const data of extractedData) {
          if ((data as any).deadline) {
            deadline = (data as any).deadline;
            break;
          }
        }
        if (!deadline) {
          const deadlineMatch = email.body.match(/d[ée]lai\s+de\s+r[ée]ponse[:\s]+([^.\n]+)/i);
          if (deadlineMatch) {
            deadline = deadlineMatch[1].trim();
          }
        }

        // Déterminer le statut
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
          status: status as any,
          acknowledgmentSent,
          deadline,
          notes: needsReview ? 'Extraction OCR - vérification requise' : undefined,
        });
      } catch (trackError) {
        this.logger.warn(`Erreur tracking: ${trackError.message}`);
      }

      // 8. Émettre les webhooks
      try {
        // Webhook: RFQ traité avec succès
        await this.webhookService.emitRfqProcessed(
          priceRequest.requestNumber,
          priceRequest.clientRfqNumber,
          priceRequest.items.length,
          generatedExcel.excelPath
        );

        // Webhook: Accusé envoyé
        if (acknowledgmentSent) {
          const toArray = Array.isArray(email.to) ? email.to : [email.to];
          await this.webhookService.emitAcknowledgmentSent(
            priceRequest.requestNumber,
            [email.from, ...toArray, ...(email.cc || [])].filter(Boolean) as string[]
          );
        }
      } catch (webhookError) {
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
    } catch (error) {
      this.logger.error(`Erreur traitement email:`, error.message);
      
      // Webhook: Erreur de traitement
      try {
        await this.webhookService.emitSystemError(`Erreur traitement email: ${error.message}`, {
          emailId: email?.id,
          subject: email?.subject,
        });
      } catch (e) {}
      
      return { success: false, email, error: error.message };
    }
  }

  private extractRfqFromSubject(subject: string): string | undefined {
    // Extraire RFQ/PR du sujet de l'email
    const match = subject.match(/(?:RFQ|PR|REF)[\s\-_:]*([A-Z0-9\-]+)/i);
    return match ? match[1] : undefined;
  }

  async processUnreadEmails(folder = 'INBOX'): Promise<ProcessAllResult> {
    const results: ProcessEmailResult[] = [];
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
        } else {
          failed++;
        }
      }
    } catch (error) {
      this.logger.error('Erreur traitement emails non lus:', error.message);
    }

    return {
      processed: results.length,
      successful,
      failed,
      results,
    };
  }

  private buildPriceRequest(
    email: ParsedEmail,
    extractedData: ExtractedPdfData[],
    supplierEmail?: string,
  ): PriceRequest {
    // Combiner tous les items des PDF
    const allItems: PriceRequestItem[] = [];
    const seenDescriptions = new Set<string>();

    // Récupérer le RFQ client et la description générale depuis les PDF extraits
    let clientRfqNumber: string | undefined;
    let generalDescription: string | undefined;

    for (const pdf of extractedData) {
      // Récupérer le numéro RFQ du client
      if (pdf.rfqNumber && !clientRfqNumber) {
        clientRfqNumber = pdf.rfqNumber;
      }
      // Récupérer la description générale (peut contenir la marque)
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

    // Si aucun item trouvé, créer des items génériques à partir du texte
    if (allItems.length === 0) {
      allItems.push({
        description: 'Article à définir (voir PDF joint)',
        quantity: 1,
        notes: 'Veuillez vous référer au PDF pour les détails',
      });
    }

    // Extraire les infos du client depuis l'email source
    const clientEmail = this.extractEmailFromSender(email.from);
    const clientName = this.extractNameFromSender(email.from) || this.extractCompanyFromEmail(clientEmail);

    // Extraire la société depuis les PDF si disponible
    let clientCompany: string | undefined;
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
      supplier: undefined, // À remplir par le fournisseur
      supplierEmail: supplierEmail || this.DEFAULT_RECIPIENT, // Par défaut: procurement@multipartsci.com
      items: allItems,
      notes: generalDescription || `Email: "${email.subject}" du ${email.date.toLocaleDateString('fr-FR')}`,
      responseDeadlineHours: this.DEFAULT_RESPONSE_HOURS, // 24h par défaut
      deadline: this.calculateDeadline(1), // 1 jour par défaut
      sourceEmail: email,
    };
  }

  private extractEmailFromSender(from: string): string {
    const match = from.match(/<([^>]+)>/) || from.match(/([\w.-]+@[\w.-]+\.\w+)/);
    return match ? match[1] : from;
  }

  private extractNameFromSender(from: string): string | undefined {
    // Format: "Nom Prénom" <email@domain.com>
    const match = from.match(/^"?([^"<]+)"?\s*</);
    if (match) {
      return match[1].trim();
    }
    return undefined;
  }

  private extractCompanyFromEmail(email: string): string | undefined {
    // Extraire le domaine de l'email: user@company.com -> company
    const match = email.match(/@([^.]+)\./);
    if (match) {
      return match[1].toUpperCase();
    }
    return undefined;
  }

  private calculateDeadline(daysFromNow = 1): Date {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysFromNow);
    return deadline;
  }

  /**
   * Envoie un accusé de réception au client (expéditeur + destinataires de l'email original)
   */
  private async sendAcknowledgmentToClient(
    email: ParsedEmail,
    priceRequest: PriceRequest,
    extractedData: ExtractedPdfData[],
  ): Promise<boolean> {
    try {
      // Convertir 'to' en array si nécessaire
      const toArray = Array.isArray(email.to) ? email.to : (email.to ? [email.to] : []);
      
      // Extraire les destinataires de l'email original
      const recipients = {
        from: email.from,
        to: toArray,
        cc: email.cc || [],
        replyTo: email.replyTo,
      };

      // Extraire le deadline depuis les données extraites ou le corps de l'email
      let deadline: string | undefined;
      for (const data of extractedData) {
        if ((data as any).deadline) {
          deadline = (data as any).deadline;
          break;
        }
      }
      // Chercher aussi dans le corps de l'email
      if (!deadline) {
        const deadlineMatch = email.body.match(/d[ée]lai\s+de\s+r[ée]ponse[:\s]+([^.\n]+)/i);
        if (deadlineMatch) {
          deadline = deadlineMatch[1].trim();
        }
      }

      // Extraire le nom du contact
      let senderName: string | undefined;
      const nameMatch = email.body.match(/(?:cordialement|cdlt|regards)[,.\s]*\n+([A-ZÉÈÀÙÂÊÎÔÛÇ][A-ZÉÈÀÙÂÊÎÔÛÇ\s]+)\n/i);
      if (nameMatch) {
        senderName = nameMatch[1].trim();
      } else {
        senderName = this.extractNameFromSender(email.from);
      }

      // Détecter l'urgence
      const isUrgent = /urgent/i.test(email.subject) || /urgent/i.test(email.body);

      // Données pour l'accusé (avec les infos de threading)
      const acknowledgmentData = {
        rfqNumber: priceRequest.clientRfqNumber || priceRequest.requestNumber,
        subject: email.subject,
        itemCount: priceRequest.items.length,
        deadline,
        senderName,
        isUrgent,
        // Headers pour le threading (réponse liée)
        originalMessageId: email.messageId,
        originalReferences: email.references,
      };

      // Petit délai pour éviter de surcharger le serveur SMTP
      const delay = this.configService.get<number>('email.acknowledgmentDelay', 5);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }

      // Envoyer l'accusé de réception
      const sent = await this.acknowledgmentService.sendAcknowledgment(recipients, acknowledgmentData);
      
      if (sent) {
        this.logger.log(`✉️ Accusé de réception envoyé pour: ${email.subject}`);
      }
      
      return sent;
    } catch (error) {
      this.logger.error(`Erreur envoi accusé de réception: ${error.message}`);
      return false;
    }
  }

  async generatePreview(emailId: string, folder = 'INBOX'): Promise<any> {
    const email = await this.emailService.fetchEmailById(emailId, folder);
    if (!email) {
      return { error: 'Email non trouvé' };
    }

    const pdfAttachments = email.attachments.filter(
      (att) => att.contentType === 'application/pdf',
    );

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

  /**
   * Détecte si l'email est probablement une offre fournisseur (pas une demande de prix)
   * Version simplifiée pour filtrer les cas évidents
   */
  private isLikelySupplierQuote(email: ParsedEmail): { isQuote: boolean; reason?: string } {
    const subject = (email.subject || '').toLowerCase();
    const body = (email.body || '').substring(0, 3000).toLowerCase();

    // Patterns d'offres dans les noms de fichiers
    const offerFilePatterns = /(quotation|quote|offer|proforma|invoice|devis|cotation|proposition|offre|facture)/i;

    for (const att of email.attachments || []) {
      const fn = (att.filename || '').toLowerCase();
      if (offerFilePatterns.test(fn)) {
        // Vérifier que ce n'est pas une "demande de" dans le nom
        if (!fn.includes('demande') && !fn.includes('request')) {
          return { isQuote: true, reason: `Fichier "${att.filename}" indique une offre/devis` };
        }
      }
    }

    // Patterns d'offres dans le sujet
    const offerSubjectPatterns = [
      'notre offre', 'our offer', 'our quotation', 'notre devis',
      'proposition commerciale', 'offre de prix', 'proforma', 'invoice',
    ];
    for (const pattern of offerSubjectPatterns) {
      if (subject.includes(pattern)) {
        return { isQuote: true, reason: `Sujet contient "${pattern}"` };
      }
    }

    // Patterns de structure devis dans le corps
    const hasBank = /\b(iban|swift|rib|coordonnees bancaires|coordonnées bancaires)\b/i.test(body);
    const hasTotals = /\b(total ht|total ttc|montant ttc|grand total|subtotal)\b/i.test(body);
    const hasValidity = /\b(valid until|validity|validite|validité)\b/i.test(body);

    if (hasBank && hasTotals) {
      return { isQuote: true, reason: 'Structure devis détectée (coordonnées bancaires + totaux)' };
    }

    if (hasTotals && hasValidity) {
      return { isQuote: true, reason: 'Structure devis détectée (totaux + validité)' };
    }

    return { isQuote: false };
  }

  /**
   * Détermine si le fallback LLM doit être activé
   */
  private shouldTriggerLlmFallback(items: PriceRequestItem[]): boolean {
    switch (this.llmMode) {
      case 'always':
        return true;

      case 'auto':
        // LLM si peu d'items
        if (items.length < this.llmMinItemsThreshold) {
          return true;
        }

        // Vérifier si les quantités semblent suspectes (possibles numéros de ligne)
        if (items.length > 0) {
          const suspiciousQtyCount = items.filter(item => {
            const qty = item.quantity;
            // Quantités suspectes: multiples de 10 (10, 20, 30, 40...)
            return qty && qty >= 10 && qty % 10 === 0 && qty <= 100;
          }).length;

          // Si plus de 50% des items ont des quantités suspectes
          if (suspiciousQtyCount > items.length / 2) {
            this.logger.warn(
              `Quantités suspectes détectées (${suspiciousQtyCount}/${items.length} multiples de 10), déclenchement LLM`,
            );
            return true;
          }
        }

        return false;

      case 'fallback':
        return items.length === 0;

      case 'off':
      default:
        return false;
    }
  }
}
