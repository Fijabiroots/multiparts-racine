import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailService } from '../../email/email.service';
import { DatabaseService } from '../../database/database.service';
import { OfferClassifierService } from './offer-classifier.service';
import { BrandMatcherService } from './brand-matcher.service';
import { SupplierDirectoryService } from './supplier-directory.service';
import { v4 as uuidv4 } from 'uuid';
import {
  SyncResult,
  SyncStatus,
  SyncedEmail,
  SyncedAttachment,
  MessageClassification,
  SupplierSyncLogRecord,
} from '../interfaces/supplier-collector.interfaces';
import { ParsedEmail } from '../../common/interfaces';

/**
 * MailSyncService
 *
 * Orchestrateur principal du module Supplier Collector.
 * Synchronise les emails depuis SENT et INBOX, classifie les réponses fournisseurs,
 * et met à jour l'annuaire Marque → Fournisseurs.
 */
@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);
  private isRunning = false;
  private lastSyncResult: SyncResult | null = null;
  private accountEmail: string;

  // Folders à synchroniser
  private readonly folders: ('INBOX' | 'SENT')[] = ['INBOX', 'SENT'];

  // Domaines internes à ignorer
  private readonly internalDomains = ['multipartsci.com', 'multiparts.ci'];

  constructor(
    private configService: ConfigService,
    private emailService: EmailService,
    private databaseService: DatabaseService,
    private classifierService: OfferClassifierService,
    private brandMatcherService: BrandMatcherService,
    private directoryService: SupplierDirectoryService,
  ) {
    this.accountEmail = this.configService.get<string>('imap.user') || 'rafiou.oyeossi@multipartsci.com';
  }

  /**
   * Job CRON: Sync toutes les heures
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync(): Promise<void> {
    this.logger.log('Scheduled sync triggered');
    await this.syncAllFolders();
  }

  /**
   * Sync manuelle de tous les dossiers
   */
  async syncAllFolders(): Promise<SyncResult[]> {
    if (this.isRunning) {
      this.logger.warn('Sync already running, skipping');
      return [];
    }

    this.isRunning = true;
    const results: SyncResult[] = [];

    try {
      for (const folder of this.folders) {
        const result = await this.syncFolder(folder);
        results.push(result);
      }

      // Sauvegarder le résultat combiné
      this.lastSyncResult = this.combineResults(results);
      this.logger.log(
        `Sync completed: ${this.lastSyncResult.messagesNew} new, ${this.lastSyncResult.offersDetected} offers, ${this.lastSyncResult.brandsMatched} brands`,
      );
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  /**
   * Sync un dossier spécifique
   */
  async syncFolder(folder: 'INBOX' | 'SENT'): Promise<SyncResult> {
    const startTime = Date.now();
    const logId = await this.createSyncLog(folder, 'incremental');

    const result: SyncResult = {
      accountEmail: this.accountEmail,
      folder,
      messagesFound: 0,
      messagesNew: 0,
      messagesSkipped: 0,
      offersDetected: 0,
      brandsMatched: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Récupérer les 30 derniers jours d'emails
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const emails = await this.emailService.fetchEmails({
        folder,
        since: thirtyDaysAgo,
      });

      result.messagesFound = emails.length;

      for (const email of emails) {
        try {
          // Vérifier si déjà traité
          if (await this.isAlreadyProcessed(email.id)) {
            result.messagesSkipped++;
            continue;
          }

          // Convertir en format interne
          const syncedEmail = this.convertToSyncedEmail(email, folder);

          // Filtrer les emails internes
          if (this.isInternalEmail(syncedEmail)) {
            result.messagesSkipped++;
            continue;
          }

          // Sauvegarder l'email
          await this.saveEmail(syncedEmail);
          result.messagesNew++;

          // Classifier l'email
          const classification = this.classifierService.classify(syncedEmail);

          // Mettre à jour la classification
          await this.updateClassification(syncedEmail.id, classification);

          // Si c'est une offre, chercher les marques et mettre à jour l'annuaire
          if (classification.classification === MessageClassification.OFFER) {
            result.offersDetected++;

            const brandMatches = this.brandMatcherService.findBrandsInEmail(syncedEmail);

            if (brandMatches.length > 0) {
              result.brandsMatched += brandMatches.length;

              // Déterminer l'email fournisseur
              const supplierEmail = this.extractSupplierEmail(syncedEmail, folder);
              const supplierName = this.extractSupplierName(syncedEmail, folder);

              // Ajouter à l'annuaire
              for (const match of brandMatches) {
                await this.directoryService.upsertBrandSupplier(
                  match,
                  supplierEmail,
                  supplierName,
                  syncedEmail.id,
                  classification.reasons,
                );
              }
            }
          }
        } catch (error) {
          result.errors.push(`Email ${email.id}: ${error.message}`);
          this.logger.error(`Error processing email ${email.id}: ${error.message}`);
        }
      }

      result.duration = Date.now() - startTime;
      await this.completeSyncLog(logId, result, 'completed');
    } catch (error) {
      result.errors.push(`Folder sync error: ${error.message}`);
      result.duration = Date.now() - startTime;
      await this.completeSyncLog(logId, result, 'error', error.message);
      this.logger.error(`Sync error for ${folder}: ${error.message}`);
    }

    return result;
  }

  /**
   * Retourne le status actuel
   */
  getStatus(): SyncStatus {
    return {
      isRunning: this.isRunning,
      lastSyncResult: this.lastSyncResult || undefined,
      lastSyncAt: this.lastSyncResult
        ? new Date(Date.now() - (this.lastSyncResult.duration || 0))
        : undefined,
    };
  }

  /**
   * Retraite les emails non classifiés
   */
  async reprocessUnclassified(): Promise<number> {
    const result = this.databaseService['db'].exec(`
      SELECT * FROM supplier_emails
      WHERE classification = 'UNPROCESSED' OR classification IS NULL
      ORDER BY date DESC
      LIMIT 100
    `);

    if (result.length === 0 || result[0].values.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const row of result[0].values) {
      const email = this.mapRowToSyncedEmail(result[0].columns, row);

      const classification = this.classifierService.classify(email);
      await this.updateClassification(email.id, classification);

      if (classification.classification === MessageClassification.OFFER) {
        const brandMatches = this.brandMatcherService.findBrandsInEmail(email);
        const supplierEmail = this.extractSupplierEmail(email, email.folder);
        const supplierName = this.extractSupplierName(email, email.folder);

        for (const match of brandMatches) {
          await this.directoryService.upsertBrandSupplier(
            match,
            supplierEmail,
            supplierName,
            email.id,
            classification.reasons,
          );
        }
      }

      processed++;
    }

    return processed;
  }

  // ============ PRIVATE METHODS ============

  private convertToSyncedEmail(email: ParsedEmail, folder: 'INBOX' | 'SENT'): SyncedEmail {
    return {
      id: uuidv4(),
      messageId: email.messageId || email.id,
      threadId: undefined,
      fromEmail: this.extractEmailAddress(email.from),
      fromName: this.extractName(email.from),
      toEmails: Array.isArray(email.to) ? email.to.map(t => this.extractEmailAddress(t)) : [this.extractEmailAddress(email.to)],
      subject: email.subject,
      date: email.date,
      bodyText: email.body,
      attachments: email.attachments.map(att => ({
        filename: att.filename,
        mimeType: att.contentType,
        size: att.size,
        isInline: att.contentType?.includes('inline') || false,
      })),
      folder,
      isRead: true,
    };
  }

  private extractEmailAddress(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return (match ? match[1] : from).toLowerCase().trim();
  }

  private extractName(from: string): string | undefined {
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim().replace(/"/g, '') : undefined;
  }

  private isInternalEmail(email: SyncedEmail): boolean {
    const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase();
    return this.internalDomains.includes(fromDomain);
  }

  private extractSupplierEmail(email: SyncedEmail, folder: 'INBOX' | 'SENT'): string {
    // INBOX: le fournisseur est l'expéditeur
    // SENT: le fournisseur est le destinataire (on a envoyé une demande et ils ont répondu)
    if (folder === 'INBOX') {
      return email.fromEmail;
    }
    // Pour SENT, on prend le premier destinataire externe
    return email.toEmails.find(e => !this.internalDomains.some(d => e.endsWith(`@${d}`))) || email.toEmails[0];
  }

  private extractSupplierName(email: SyncedEmail, folder: 'INBOX' | 'SENT'): string | undefined {
    if (folder === 'INBOX') {
      return email.fromName;
    }
    return undefined;
  }

  private async isAlreadyProcessed(messageId: string): Promise<boolean> {
    const result = this.databaseService['db'].exec(
      `SELECT id FROM supplier_emails WHERE message_id = ? LIMIT 1`,
      [messageId],
    );
    return result.length > 0 && result[0].values.length > 0;
  }

  private async saveEmail(email: SyncedEmail): Promise<void> {
    const now = new Date().toISOString();

    this.databaseService['db'].run(
      `
      INSERT INTO supplier_emails
      (id, message_id, account_email, folder, from_email, from_name, to_emails, subject, date,
       body_snippet, attachment_count, attachment_names, classification, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        email.id,
        email.messageId,
        this.accountEmail,
        email.folder,
        email.fromEmail,
        email.fromName || null,
        JSON.stringify(email.toEmails),
        email.subject,
        email.date.toISOString(),
        email.bodyText?.substring(0, 500) || null,
        email.attachments.length,
        JSON.stringify(email.attachments.map(a => a.filename)),
        MessageClassification.UNPROCESSED,
        now,
      ],
    );

    this.databaseService.saveToFile();
  }

  private async updateClassification(
    emailId: string,
    classification: { classification: MessageClassification; score: number; reasons: string[] },
  ): Promise<void> {
    const now = new Date().toISOString();

    this.databaseService['db'].run(
      `
      UPDATE supplier_emails
      SET classification = ?, classification_score = ?, classification_reasons = ?, processed_at = ?
      WHERE id = ?
    `,
      [
        classification.classification,
        classification.score,
        JSON.stringify(classification.reasons),
        now,
        emailId,
      ],
    );

    this.databaseService.saveToFile();
  }

  private async createSyncLog(folder: string, syncType: string): Promise<string> {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.databaseService['db'].run(
      `
      INSERT INTO supplier_sync_logs
      (id, account_email, folder, sync_type, started_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [id, this.accountEmail, folder, syncType, now, 'running'],
    );

    this.databaseService.saveToFile();
    return id;
  }

  private async completeSyncLog(
    logId: string,
    result: SyncResult,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    this.databaseService['db'].run(
      `
      UPDATE supplier_sync_logs
      SET completed_at = ?, messages_found = ?, messages_new = ?, messages_skipped = ?,
          offers_detected = ?, brands_matched = ?, status = ?, error_message = ?
      WHERE id = ?
    `,
      [
        now,
        result.messagesFound,
        result.messagesNew,
        result.messagesSkipped,
        result.offersDetected,
        result.brandsMatched,
        status,
        errorMessage || null,
        logId,
      ],
    );

    this.databaseService.saveToFile();
  }

  private combineResults(results: SyncResult[]): SyncResult {
    return {
      accountEmail: this.accountEmail,
      folder: 'ALL' as any,
      messagesFound: results.reduce((sum, r) => sum + r.messagesFound, 0),
      messagesNew: results.reduce((sum, r) => sum + r.messagesNew, 0),
      messagesSkipped: results.reduce((sum, r) => sum + r.messagesSkipped, 0),
      offersDetected: results.reduce((sum, r) => sum + r.offersDetected, 0),
      brandsMatched: results.reduce((sum, r) => sum + r.brandsMatched, 0),
      errors: results.flatMap(r => r.errors),
      duration: results.reduce((sum, r) => sum + r.duration, 0),
    };
  }

  private mapRowToSyncedEmail(columns: string[], row: any[]): SyncedEmail {
    const obj: any = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });

    return {
      id: obj.id,
      messageId: obj.message_id,
      fromEmail: obj.from_email,
      fromName: obj.from_name,
      toEmails: JSON.parse(obj.to_emails || '[]'),
      subject: obj.subject,
      date: new Date(obj.date),
      bodyText: obj.body_snippet,
      attachments: JSON.parse(obj.attachment_names || '[]').map((name: string) => ({
        filename: name,
        mimeType: 'application/octet-stream',
        isInline: false,
      })),
      folder: obj.folder as 'INBOX' | 'SENT',
      isRead: true,
    };
  }
}
