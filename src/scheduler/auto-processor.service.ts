import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { DetectorService } from '../detector/detector.service';
import { DocumentParserService } from '../parser/document-parser.service';
import { AttachmentClassifierService, ClassifiedAttachment, AttachmentCategory } from '../parser/attachment-classifier.service';
import { ExcelService } from '../excel/excel.service';
import { DraftService } from '../draft/draft.service';
import { TrackingService } from '../tracking/tracking.service';
import { UnifiedIngestionService } from '../ingestion/unified-ingestion.service';
import { ParseLogService } from '../ingestion/parse-log.service';
import { ParsedEmail, PriceRequest, PriceRequestItem, ClientRequirements, EmailAttachment } from '../common/interfaces';
import { Client } from '../database/entities';
import {
  extractClientRequirements,
  calculateDeadlineWithBusinessHours,
  hasImportantRequirements,
} from '../common/client-requirements';

interface ProcessOptions {
  endDate?: Date;
  folders: string[];
  autoSendDraft: boolean;
}

/**
 * Résultat du traitement d'une seule demande extraite d'un email
 */
interface SingleRequestResult {
  internalRfqNumber: string;
  clientRfqNumber?: string;
  excelPath: string;
  brand?: string;
  itemCount: number;
  technicalSheets: string[]; // Noms des fiches techniques associées
}

/**
 * Groupe de pièces jointes à traiter ensemble
 */
interface AttachmentGroup {
  rfqAttachments: ClassifiedAttachment[];
  technicalSheets: ClassifiedAttachment[];
  brand?: string;
}

export interface ProcessResult {
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  details: Array<{
    emailId: string;
    subject: string;
    status: 'success' | 'failed' | 'skipped' | 'not_price_request';
    internalRfqNumber?: string;
    clientRfqNumber?: string;
    error?: string;
  }>;
}

@Injectable()
export class AutoProcessorService {
  private readonly logger = new Logger(AutoProcessorService.name);

  // Flag to use the new unified ingestion pipeline (set to true to enable)
  private readonly useUnifiedIngestion = true;

  // Adresse email courante du mailbox en cours de traitement
  private currentMailbox: string = 'procurement@multipartsci.com';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
    private readonly detectorService: DetectorService,
    private readonly documentParser: DocumentParserService,
    private readonly attachmentClassifier: AttachmentClassifierService,
    private readonly excelService: ExcelService,
    private readonly draftService: DraftService,
    private readonly trackingService: TrackingService,
    @Optional() private readonly unifiedIngestion?: UnifiedIngestionService,
    @Optional() private readonly parseLogService?: ParseLogService,
  ) {}

  async processNewEmails(options: ProcessOptions): Promise<ProcessResult> {
    const result: ProcessResult = {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    for (const folder of options.folders) {
      try {
        // Récupérer les emails non lus
        const emails = await this.emailService.fetchEmails({
          folder,
          unseen: true,
          limit: 500, // Augmenté pour traiter tous les emails en attente
        });

        this.logger.log(`${emails.length} emails non lus trouvés dans ${folder}`);

        for (const email of emails) {
          // Vérifier la date limite
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

          // Vérifier si déjà traité (par UID IMAP ou Message-ID pour cross-mailbox)
          const isProcessedByUid = await this.databaseService.isEmailProcessed(email.id);
          const isProcessedByMessageId = email.messageId
            ? await this.databaseService.isMessageIdProcessed(email.messageId)
            : false;

          if (isProcessedByUid || isProcessedByMessageId) {
            result.skipped++;
            result.details.push({
              emailId: email.id,
              subject: email.subject,
              status: 'skipped',
              error: isProcessedByMessageId
                ? 'Déjà traité (même email reçu sur autre boîte)'
                : 'Déjà traité',
            });
            continue;
          }

          // NOUVEAU: Vérifier si c'est une offre fournisseur (réponse à une RFQ)
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

          // Analyser si c'est une demande de prix
          const detection = await this.detectorService.analyzeEmail(email);
          
          if (!detection.isPriceRequest) {
            result.skipped++;
            result.details.push({
              emailId: email.id,
              subject: email.subject,
              status: 'not_price_request',
              error: detection.reason,
            });
            
            // Logger mais ne pas créer de mapping
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
            // Traiter l'email
            const processResult = await this.processEmail(email, options.autoSendDraft);
            
            result.successful++;
            result.details.push({
              emailId: email.id,
              subject: email.subject,
              status: 'success',
              internalRfqNumber: processResult.internalRfqNumber,
              clientRfqNumber: processResult.clientRfqNumber,
            });

          } catch (error) {
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
      } catch (error) {
        this.logger.error(`Erreur lecture dossier ${folder}:`, error.message);
      }
    }

    return result;
  }

  async processEmail(email: ParsedEmail, autoSendDraft: boolean): Promise<{
    internalRfqNumber: string;
    clientRfqNumber?: string;
    excelPath: string;
  }> {
    // ═══════════════════════════════════════════════════════════════════════
    // NOUVEAU: Traitement multi-demandes
    // ═══════════════════════════════════════════════════════════════════════

    // 1. Classifier toutes les pièces jointes
    const classifiedAttachments = this.attachmentClassifier.classifyAttachments(email.attachments);

    // Séparer RFQs, fiches techniques et images
    const rfqAttachments = classifiedAttachments.filter(c => c.category === 'rfq');
    const technicalSheets = classifiedAttachments.filter(c => c.category === 'technical_sheet');
    const images = classifiedAttachments.filter(c => c.category === 'image' && c.confidence < 100);

    this.logger.debug(
      `Attachments classifiés: ${rfqAttachments.length} RFQ, ${technicalSheets.length} fiches techniques, ${images.length} images`
    );

    // 2. Grouper les RFQs
    const groups = this.groupRfqAttachments(rfqAttachments, technicalSheets);

    this.logger.debug(`${groups.length} groupe(s) de demandes à traiter`);

    // 3. Traiter chaque groupe
    const results: SingleRequestResult[] = [];

    for (const group of groups) {
      try {
        const result = await this.processAttachmentGroup(email, group, autoSendDraft, images);
        results.push(result);
      } catch (error) {
        this.logger.error(`Erreur traitement groupe ${group.brand || 'unknown'}: ${error.message}`);
      }
    }

    // 4. Si aucun résultat, traiter l'email de manière classique (fallback)
    if (results.length === 0) {
      return this.processEmailClassic(email, autoSendDraft);
    }

    // Retourner le premier résultat (pour compatibilité avec l'interface existante)
    // Les autres résultats ont déjà été sauvegardés
    const firstResult = results[0];

    if (results.length > 1) {
      this.logger.log(
        `Email traité en ${results.length} demandes distinctes: ${results.map(r => r.internalRfqNumber).join(', ')}`
      );
    }

    return {
      internalRfqNumber: firstResult.internalRfqNumber,
      clientRfqNumber: firstResult.clientRfqNumber,
      excelPath: firstResult.excelPath,
    };
  }

  /**
   * Grouper les attachements RFQ par marque ou individuellement
   */
  private groupRfqAttachments(
    rfqAttachments: ClassifiedAttachment[],
    technicalSheets: ClassifiedAttachment[],
  ): AttachmentGroup[] {
    // Si aucun RFQ, retourner un groupe vide (sera traité par fallback)
    if (rfqAttachments.length === 0) {
      return [];
    }

    // Si un seul RFQ, créer un groupe unique
    if (rfqAttachments.length === 1) {
      return [{
        rfqAttachments,
        technicalSheets: technicalSheets.filter(ts => !ts.relatedTo || ts.relatedTo === rfqAttachments[0].attachment.filename),
        brand: rfqAttachments[0].brand,
      }];
    }

    // Si tous les RFQs ont la même marque, les grouper ensemble
    if (this.attachmentClassifier.allSameBrand(rfqAttachments)) {
      const brand = rfqAttachments[0].brand;
      this.logger.debug(`Tous les RFQs ont la même marque (${brand}), regroupement`);
      return [{
        rfqAttachments,
        technicalSheets,
        brand,
      }];
    }

    // Sinon, créer un groupe par RFQ
    const groups: AttachmentGroup[] = [];

    for (const rfq of rfqAttachments) {
      // Trouver les fiches techniques associées à ce RFQ
      const matchingSheets = technicalSheets.filter(ts =>
        ts.relatedTo === rfq.attachment.filename ||
        ts.brand === rfq.brand
      );

      groups.push({
        rfqAttachments: [rfq],
        technicalSheets: matchingSheets,
        brand: rfq.brand,
      });
    }

    return groups;
  }

  /**
   * Traiter un groupe de pièces jointes comme une demande unique
   */
  private async processAttachmentGroup(
    email: ParsedEmail,
    group: AttachmentGroup,
    autoSendDraft: boolean,
    images: ClassifiedAttachment[],
  ): Promise<SingleRequestResult> {
    // 1. Identifier ou créer le client
    const client = await this.findOrCreateClient(email);

    // 2. Générer le numéro RFQ interne
    const internalRfqNumber = this.excelService.generateRequestNumber();

    let allItems: PriceRequestItem[] = [];
    let clientRfqNumber: string | undefined;
    let needsManualReview = false;

    // 3. Parser uniquement les pièces jointes de ce groupe
    const groupAttachments = group.rfqAttachments.map(c => c.attachment);

    // Use unified ingestion pipeline if available and enabled
    if (this.useUnifiedIngestion && this.unifiedIngestion) {
      this.logger.debug(`Using unified ingestion for group: ${group.brand || 'unknown'}`);

      // Créer un email virtuel avec uniquement les pièces jointes du groupe
      const virtualEmail: ParsedEmail = {
        ...email,
        attachments: groupAttachments,
      };

      const ingestionResult = await this.unifiedIngestion.processEmail(
        virtualEmail,
        internalRfqNumber
      );

      allItems = ingestionResult.items;
      clientRfqNumber = ingestionResult.rfqNumber || group.rfqAttachments[0]?.rfqNumber;
      needsManualReview = ingestionResult.needsVerification;

      if (ingestionResult.warnings.length > 0) {
        this.logger.warn(`Ingestion warnings: ${ingestionResult.warnings.join(', ')}`);
      }
    } else {
      // Fallback to legacy parser
      const parsedDocs = await this.documentParser.parseAllAttachments(groupAttachments);

      for (const doc of parsedDocs) {
        if (doc.rfqNumber && !clientRfqNumber) {
          clientRfqNumber = doc.rfqNumber;
        }

        for (const item of doc.items) {
          allItems.push({
            ...item,
            brand: item.brand || group.brand,
            notes: item.notes || `Source: ${doc.filename}`,
          });
        }

        if (doc.needsVerification) {
          needsManualReview = true;
        }
      }
    }

    // 4. Si aucun item, créer un item générique
    if (allItems.length === 0) {
      allItems.push({
        description: 'Article à définir - voir documents joints',
        quantity: 1,
        brand: group.brand,
        notes: 'Veuillez consulter les pièces jointes pour les détails',
      });
    }

    // 5. Extraire les exigences client
    const clientRequirements = extractClientRequirements(
      email.subject,
      email.body,
      email.replyTo,
    );

    if (hasImportantRequirements(clientRequirements)) {
      this.logger.log(`Exigences client détectées: ${JSON.stringify(clientRequirements)}`);
    }

    const defaultDeadlineHours = 24;
    const deadline = clientRequirements.responseDeadlineDate
      ? clientRequirements.responseDeadlineDate
      : calculateDeadlineWithBusinessHours(email.date, defaultDeadlineHours);

    // 6. Créer la demande de prix
    const priceRequest: PriceRequest = {
      requestNumber: internalRfqNumber,
      date: new Date(),
      items: allItems,
      notes: group.brand ? `Marque: ${group.brand}` : `Réf. interne: ${internalRfqNumber}`,
      deadline,
      responseDeadlineHours: clientRequirements.responseDeadlineDate
        ? Math.ceil((clientRequirements.responseDeadlineDate.getTime() - Date.now()) / (1000 * 60 * 60))
        : defaultDeadlineHours,
      needsManualReview,
      clientRequirements,
      sourceEmail: email,
      // Ajouter les fiches techniques et images comme pièces jointes supplémentaires
      additionalAttachments: [
        ...group.technicalSheets.map(ts => ts.attachment),
        ...images.map(img => img.attachment),
      ],
    };

    // 7. Générer le fichier Excel
    const generated = await this.excelService.generatePriceRequestExcel(priceRequest);

    // 8. Créer le mapping dans la base de données
    const mapping = await this.databaseService.createRfqMapping({
      clientId: client?.id,
      clientRfqNumber,
      internalRfqNumber,
      emailId: email.id,
      messageId: email.messageId,
      emailSubject: email.subject,
      receivedAt: email.date,
      status: 'processed',
      excelPath: generated.excelPath,
      mailbox: this.currentMailbox,
    });

    // 9. Créer un brouillon
    if (autoSendDraft) {
      const senderEmail = this.extractEmail(email.from);
      const senderName = this.extractName(email.from);
      const clientName = client?.name || senderName || this.extractCompanyFromEmail(senderEmail);

      // Collecter toutes les pièces jointes supplémentaires
      const attachmentPaths = [
        ...group.technicalSheets.map(ts => ts.attachment.filename),
        ...images.map(img => img.attachment.filename),
      ];

      const draftId = await this.databaseService.createPendingDraft({
        rfqMappingId: mapping?.id,
        internalRfqNumber,
        clientRfqNumber,
        clientName,
        clientEmail: senderEmail,
        recipient: 'procurement@multipartsci.com',
        subject: `Demande de Prix N° ${internalRfqNumber}${group.brand ? ` - ${group.brand}` : ''}${clientRfqNumber ? ` - Réf. Client: ${clientRfqNumber}` : ''}`,
        excelPath: generated.excelPath,
        attachmentPaths,
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

      this.logger.log(`Brouillon créé: ${draftId}${group.brand ? ` (${group.brand})` : ''}`);

      // Sauvegarder dans IMAP Drafts
      try {
        // Préparer les pièces jointes pour le brouillon
        const draftAttachments = [
          {
            filename: `${internalRfqNumber}.xlsx`,
            content: generated.excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          // Ajouter les fiches techniques
          ...group.technicalSheets.map(ts => ({
            filename: ts.attachment.filename,
            content: ts.attachment.content,
            contentType: ts.attachment.contentType,
          })),
        ];

        await this.draftService.saveToDrafts({
          to: 'procurement@multipartsci.com',
          subject: `Demande de Prix N° ${internalRfqNumber}${group.brand ? ` - ${group.brand}` : ''}${clientRfqNumber ? ` - Réf. Client: ${clientRfqNumber}` : ''}`,
          body: this.generateEmailBodyForProcurement(
            internalRfqNumber,
            clientRfqNumber,
            clientName,
            senderEmail,
            allItems.length,
            group.technicalSheets.length,
          ),
          attachments: draftAttachments,
        });
      } catch (error) {
        this.logger.warn(`Impossible de sauvegarder dans IMAP Drafts: ${error.message}`);
      }

      if (mapping) {
        await this.databaseService.updateRfqMappingStatus(mapping.id, 'draft_pending');
      }
    }

    // 10. Logger le succès
    await this.databaseService.addProcessingLog({
      rfqMappingId: mapping?.id,
      emailId: email.id,
      action: 'process',
      status: 'success',
      message: `Traité avec succès. RFQ interne: ${internalRfqNumber}${group.brand ? ` (${group.brand})` : ''}, Items: ${allItems.length}, Fiches tech: ${group.technicalSheets.length}`,
    });

    // 11. Ajouter au fichier de suivi RFQ
    try {
      const trackSenderEmail = this.extractEmail(email.from);
      const trackSenderName = this.extractName(email.from);
      const trackClientName = client?.name || trackSenderName || this.extractCompanyFromEmail(trackSenderEmail);

      await this.trackingService.addEntry({
        timestamp: new Date(),
        clientRfqNumber,
        internalRfqNumber,
        clientName: trackClientName,
        clientEmail: trackSenderEmail,
        subject: email.subject,
        itemCount: allItems.length,
        status: 'traité',
        acknowledgmentSent: false,
        notes: `${allItems.length} article(s)${group.brand ? `, marque: ${group.brand}` : ''}${group.technicalSheets.length > 0 ? `, ${group.technicalSheets.length} fiche(s) tech.` : ''}`,
      });
    } catch (trackError) {
      this.logger.warn('Erreur tracking: ' + trackError.message);
    }

    return {
      internalRfqNumber,
      clientRfqNumber,
      excelPath: generated.excelPath,
      brand: group.brand,
      itemCount: allItems.length,
      technicalSheets: group.technicalSheets.map(ts => ts.attachment.filename),
    };
  }

  /**
   * Traitement classique d'un email (fallback quand pas de classification)
   */
  private async processEmailClassic(email: ParsedEmail, autoSendDraft: boolean): Promise<{
    internalRfqNumber: string;
    clientRfqNumber?: string;
    excelPath: string;
  }> {
    // 1. Identifier ou créer le client
    const client = await this.findOrCreateClient(email);

    // Generate internal RFQ number early (needed for parse log)
    const internalRfqNumber = this.excelService.generateRequestNumber();

    let allItems: PriceRequestItem[] = [];
    let clientRfqNumber: string | undefined;
    let needsManualReview = false;

    // Use unified ingestion pipeline if available and enabled
    if (this.useUnifiedIngestion && this.unifiedIngestion) {
      this.logger.debug('Using unified ingestion pipeline');

      const ingestionResult = await this.unifiedIngestion.processEmail(
        email,
        internalRfqNumber
      );

      allItems = ingestionResult.items;
      clientRfqNumber = ingestionResult.rfqNumber;
      needsManualReview = ingestionResult.needsVerification;

      // Log warnings
      if (ingestionResult.warnings.length > 0) {
        this.logger.warn(`Ingestion warnings: ${ingestionResult.warnings.join(', ')}`);
      }

      // Log summary from parse log
      if (this.parseLogService) {
        const summary = this.parseLogService.generateSummary(ingestionResult.parseLog);
        this.logger.debug(summary);
      }
    } else {
      // Fallback to legacy document parser
      this.logger.debug('Using legacy document parser');

      // 2. Parser les documents (pièces jointes + corps email)
      const parsedDocs = await this.documentParser.parseAllAttachments(email.attachments);
      const emailBodyData = this.documentParser.parseEmailBody(email.body, email.subject);
      parsedDocs.push(emailBodyData);

      // 3. Extraire le numéro RFQ client
      for (const doc of parsedDocs) {
        if (doc.rfqNumber) {
          clientRfqNumber = doc.rfqNumber;
          break;
        }
      }

      // 4. Collecter tous les items
      const seenDescriptions = new Set<string>();

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
        // Check if any document needs verification
        if (doc.needsVerification) {
          needsManualReview = true;
        }
      }
    }

    // Si aucun item, en créer un générique
    if (allItems.length === 0) {
      allItems.push({
        description: 'Article à définir - voir documents joints',
        quantity: 1,
        notes: 'Veuillez consulter les pièces jointes pour les détails',
      });
    }

    // 5. Extraire les exigences client (délai de réponse, adresse de réponse, urgence)
    const clientRequirements = extractClientRequirements(
      email.subject,
      email.body,
      email.replyTo,
    );

    // Log si exigences importantes détectées
    if (hasImportantRequirements(clientRequirements)) {
      this.logger.log(`⚠️ Exigences client détectées: ${JSON.stringify(clientRequirements)}`);
    }

    // Calculer le délai en tenant compte des heures ouvrées
    // Si le client a spécifié un délai, l'utiliser, sinon délai par défaut de 24h
    const defaultDeadlineHours = 24;
    const deadline = clientRequirements.responseDeadlineDate
      ? clientRequirements.responseDeadlineDate
      : calculateDeadlineWithBusinessHours(email.date, defaultDeadlineHours);

    // 6. Créer la demande de prix (SANS infos client dans le corps)
    const priceRequest: PriceRequest = {
      requestNumber: internalRfqNumber,
      date: new Date(),
      // PAS de supplier ni supplierEmail ici - anonymisé
      items: allItems,
      notes: `Réf. interne: ${internalRfqNumber}`,
      deadline,
      responseDeadlineHours: clientRequirements.responseDeadlineDate
        ? Math.ceil((clientRequirements.responseDeadlineDate.getTime() - Date.now()) / (1000 * 60 * 60))
        : defaultDeadlineHours,
      needsManualReview,
      clientRequirements, // Ajouter les exigences client pour affichage en ROUGE
      sourceEmail: email, // Pour la date de réception
    };

    // 7. Générer le fichier Excel
    const generated = await this.excelService.generatePriceRequestExcel(priceRequest);

    // 8. Créer le mapping dans la base de données
    const mapping = await this.databaseService.createRfqMapping({
      clientId: client?.id,
      clientRfqNumber,
      internalRfqNumber,
      emailId: email.id,
      messageId: email.messageId, // Pour déduplication cross-mailbox
      emailSubject: email.subject,
      receivedAt: email.date,
      status: 'processed',
      excelPath: generated.excelPath,
      mailbox: this.currentMailbox, // Adresse email qui a traité le message
    });

    // 9. Créer un brouillon en attente (envoi automatique au prochain cycle)
    if (autoSendDraft) {
      const senderEmail = this.extractEmail(email.from);
      const senderName = this.extractName(email.from);
      const clientName = client?.name || senderName || this.extractCompanyFromEmail(senderEmail);
      
      // Créer le brouillon en attente dans la base de données
      // Il sera envoyé automatiquement au prochain cycle du scheduler (5 min)
      const draftId = await this.databaseService.createPendingDraft({
        rfqMappingId: mapping?.id,
        internalRfqNumber,
        clientRfqNumber,
        clientName: clientName,
        clientEmail: senderEmail,
        recipient: 'procurement@multipartsci.com', // Toujours vers procurement
        subject: `Demande de Prix N° ${internalRfqNumber}${clientRfqNumber ? ` - Réf. Client: ${clientRfqNumber}` : ''}`,
        excelPath: generated.excelPath,
        // Ajouter les pièces jointes images si présentes
        attachmentPaths: email.attachments
          .filter(att => att.contentType?.startsWith('image/'))
          .map(att => att.filename),
      });

      // Logger la création du brouillon
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

      // AUSSI sauvegarder dans IMAP (Brouillons Thunderbird) pour visualisation
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
      } catch (error) {
        this.logger.warn(`Impossible de sauvegarder dans IMAP Drafts: ${error.message}`);
      }

      if (mapping) {
        await this.databaseService.updateRfqMappingStatus(mapping.id, 'draft_pending');
      }
    }

    // 10. Logger le succès
    await this.databaseService.addProcessingLog({
      rfqMappingId: mapping?.id,
      emailId: email.id,
      action: 'process',
      status: 'success',
      message: `Traité avec succès. RFQ interne: ${internalRfqNumber}, RFQ client: ${clientRfqNumber || 'non détecté'}`,
    });

    // 11. Ajouter au fichier de suivi RFQ
    try {
      const trackSenderEmail = this.extractEmail(email.from);
      const trackSenderName = this.extractName(email.from);
      const trackClientName = client?.name || trackSenderName || this.extractCompanyFromEmail(trackSenderEmail);
      await this.trackingService.addEntry({
        timestamp: new Date(),
        clientRfqNumber,
        internalRfqNumber,
        clientName: trackClientName,
        clientEmail: trackSenderEmail,
        subject: email.subject,
        itemCount: allItems.length,
        status: 'traité',
        acknowledgmentSent: false,
        notes: allItems.length + ' article(s) extrait(s)',
      });
      this.logger.log('Entrée ajoutée au suivi RFQ: ' + internalRfqNumber);
    } catch (trackError) {
      this.logger.warn('Erreur tracking: ' + trackError.message);
    }

    return {
      internalRfqNumber,
      clientRfqNumber,
      excelPath: generated.excelPath,
    };
  }

  private async findOrCreateClient(email: ParsedEmail): Promise<Client | null> {
    const senderEmail = this.extractEmail(email.from);
    
    // Chercher client existant
    let client = await this.databaseService.getClientByEmail(senderEmail);
    
    if (!client) {
      // Extraire nom potentiel de l'expéditeur
      const senderName = this.extractName(email.from);
      
      // Générer un code unique
      const code = this.generateClientCode(senderName || senderEmail);
      
      // Créer le client
      try {
        client = await this.databaseService.createClient({
          code,
          name: senderName || senderEmail.split('@')[0],
          email: senderEmail,
        });
        if (client) {
          this.logger.log(`Nouveau client créé: ${client.code}`);
        }
      } catch (error) {
        // Si erreur (code dupliqué), essayer de récupérer
        client = await this.databaseService.getClientByEmail(senderEmail);
      }
    }

    return client;
  }

  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/) || from.match(/([\w.-]+@[\w.-]+\.\w+)/);
    return match ? match[1] : from;
  }

  private extractName(from: string): string | undefined {
    // Format: "Nom Prénom <email@domain.com>"
    const match = from.match(/^"?([^"<]+)"?\s*</);
    if (match) {
      return match[1].trim();
    }
    return undefined;
  }

  private generateClientCode(base: string): string {
    // Prendre les 3 premières lettres + timestamp
    const prefix = base.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const timestamp = Date.now().toString(36).toUpperCase().substring(-4);
    return `CLI-${prefix}${timestamp}`;
  }

  private calculateDeadline(days: number): Date {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);
    return deadline;
  }

  private extractCompanyFromEmail(email: string): string {
    // Extraire le domaine de l'email: user@endeavourmining.com -> ENDEAVOURMINING
    const match = email.match(/@([^.]+)\./);
    if (match) {
      return match[1].toUpperCase();
    }
    return 'CLIENT';
  }

  private generateEmailBodyForProcurement(
    internalRfqNumber: string,
    clientRfqNumber: string | undefined,
    clientName: string | undefined,
    clientEmail: string,
    itemsCount: number,
    technicalSheetsCount: number = 0,
  ): string {
    const responseHours = 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);

    let techSheetsInfo = '';
    if (technicalSheetsCount > 0) {
      techSheetsInfo = `\nFiches techniques jointes: ${technicalSheetsCount}`;
    }

    return `Bonjour,

Veuillez trouver ci-joint une nouvelle demande de prix à traiter.

═══════════════════════════════════════════════════════
INFORMATIONS DEMANDE
═══════════════════════════════════════════════════════
N° Demande interne: ${internalRfqNumber}
Date: ${new Date().toLocaleDateString('fr-FR')}
Nombre d'articles: ${itemsCount}${techSheetsInfo}
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
4. Retourner le fichier complété${technicalSheetsCount > 0 ? '\n5. Consulter les fiches techniques jointes pour les spécifications' : ''}

---
Ce message a été généré automatiquement par le système de gestion des demandes de prix.
Ce brouillon sera envoyé automatiquement s'il n'est pas traité manuellement.`;
  }

  private generateAnonymizedEmailBody(rfqNumber: string, itemsCount: number): string {
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

  /**
   * Vérifie si l'email est une offre/réponse fournisseur (pas une demande client)
   * Ces emails ne doivent PAS être traités comme des RFQ
   */
  private async isSupplierQuote(email: ParsedEmail): Promise<{ isSupplierQuote: boolean; reason?: string }> {
    const subject = email.subject.toLowerCase();
    const body = email.body.toLowerCase();
    const from = email.from.toLowerCase();

    // 1. Vérifier si c'est une réponse (RE:, FW:, TR:)
    if (/^(re:|fw:|fwd:|tr:)/i.test(email.subject)) {
      // Vérifier si c'est une réponse à notre propre demande
      if (subject.includes('demande de prix') || subject.includes('ddp-')) {
        return { isSupplierQuote: true, reason: 'Réponse à une demande de prix' };
      }
    }

    // 2. Vérifier les mots-clés d'offre fournisseur dans le sujet
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

    // 3. Vérifier si l'expéditeur est un fournisseur connu
    const senderEmail = this.extractEmail(from);
    const isKnownSupplier = await this.databaseService.isKnownSupplier(senderEmail);
    
    if (isKnownSupplier) {
      return { isSupplierQuote: true, reason: `Fournisseur connu: ${senderEmail}` };
    }

    // 4. Vérifier si le sujet contient un numéro de demande interne (réponse à notre demande)
    if (/ddp-\d{8}-\d{3}/i.test(subject)) {
      return { isSupplierQuote: true, reason: 'Référence interne DDP détectée' };
    }

    // 5. Vérifier si le corps contient des signes d'offre
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

    // 6. Vérifier le domaine de l'expéditeur (clients connus)
    const knownClientDomains = [
      'endeavourmining.com',
      'endeavour.com',
      'ity.ci',
      // Ajouter d'autres domaines clients ici
    ];

    const senderDomain = senderEmail.split('@')[1];
    if (knownClientDomains.some(d => senderDomain?.includes(d))) {
      // C'est probablement une demande client, pas une offre
      return { isSupplierQuote: false };
    }

    return { isSupplierQuote: false };
  }
}
