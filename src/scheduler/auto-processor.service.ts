import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { DetectorService } from '../detector/detector.service';
import { DocumentParserService } from '../parser/document-parser.service';
import { ExcelService } from '../excel/excel.service';
import { DraftService } from '../draft/draft.service';
import { ParsedEmail, PriceRequest, PriceRequestItem } from '../common/interfaces';
import { Client } from '../database/entities';

interface ProcessOptions {
  endDate?: Date;
  folders: string[];
  autoSendDraft: boolean;
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

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
    private readonly detectorService: DetectorService,
    private readonly documentParser: DocumentParserService,
    private readonly excelService: ExcelService,
    private readonly draftService: DraftService,
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
          limit: 50, // Limiter pour éviter surcharge
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

          // Vérifier si déjà traité
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
    // 1. Identifier ou créer le client
    const client = await this.findOrCreateClient(email);

    // 2. Parser les documents (pièces jointes + corps email)
    const parsedDocs = await this.documentParser.parseAllAttachments(email.attachments);
    const emailBodyData = this.documentParser.parseEmailBody(email.body, email.subject);
    parsedDocs.push(emailBodyData);

    // 3. Extraire le numéro RFQ client
    let clientRfqNumber: string | undefined;
    for (const doc of parsedDocs) {
      if (doc.rfqNumber) {
        clientRfqNumber = doc.rfqNumber;
        break;
      }
    }

    // 4. Collecter tous les items
    const allItems: PriceRequestItem[] = [];
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
    }

    // Si aucun item, en créer un générique
    if (allItems.length === 0) {
      allItems.push({
        description: 'Article à définir - voir documents joints',
        quantity: 1,
        notes: 'Veuillez consulter les pièces jointes pour les détails',
      });
    }

    // 5. Générer le numéro RFQ interne
    const internalRfqNumber = this.excelService.generateRequestNumber();

    // 6. Créer la demande de prix (SANS infos client dans le corps)
    const priceRequest: PriceRequest = {
      requestNumber: internalRfqNumber,
      date: new Date(),
      // PAS de supplier ni supplierEmail ici - anonymisé
      items: allItems,
      notes: `Réf. interne: ${internalRfqNumber}`,
      deadline: this.calculateDeadline(14),
    };

    // 7. Générer le fichier Excel
    const generated = await this.excelService.generatePriceRequestExcel(priceRequest);

    // 8. Créer le mapping dans la base de données
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
  ): string {
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
