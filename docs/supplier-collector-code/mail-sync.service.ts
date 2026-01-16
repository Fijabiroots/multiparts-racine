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

  // Folders à synchroniser (IMAP paths)
  private readonly folders: string[] = ['INBOX', 'INBOX/Sent'];

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
  async syncFolder(folder: string): Promise<SyncResult> {
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
      // Récupérer les 30 derniers jours d'emails (max 100 per sync to prevent memory issues)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const emails = await this.emailService.fetchEmails({
        folder,
        since: thirtyDaysAgo,
        limit: 100, // Limit to prevent memory exhaustion
        timeout: 120000, // 2 minute timeout for IMAP operations
      });

      result.messagesFound = emails.length;

      // Déterminer le type de dossier (INBOX ou SENT)
      const folderType = this.determineFolderType(folder);
      const BATCH_SAVE_INTERVAL = 20; // Save to file every 20 emails
      let processedSinceLastSave = 0;

      for (const email of emails) {
        try {
          // Vérifier si déjà traité
          if (await this.isAlreadyProcessed(email.id)) {
            result.messagesSkipped++;
            continue;
          }

          // Convertir en format interne
          const syncedEmail = this.convertToSyncedEmail(email, folderType);

          // Filtrer les emails internes uniquement pour INBOX
          if (folderType === 'INBOX' && this.isInternalEmail(syncedEmail)) {
            result.messagesSkipped++;
            continue;
          }

          // Sauvegarder l'email
          await this.saveEmail(syncedEmail);
          result.messagesNew++;
          processedSinceLastSave++;

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
              const supplierEmail = this.extractSupplierEmail(syncedEmail, folderType);
              const supplierName = this.extractSupplierName(syncedEmail, folderType);

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

          // Batch save every N emails to prevent data loss without excessive I/O
          if (processedSinceLastSave >= BATCH_SAVE_INTERVAL) {
            this.databaseService.saveToFile();
            processedSinceLastSave = 0;
          }
        } catch (error) {
          result.errors.push(`Email ${email.id}: ${error.message}`);
          this.logger.error(`Error processing email ${email.id}: ${error.message}`);
        }
      }

      // Final batch save for remaining emails
      if (processedSinceLastSave > 0) {
        this.databaseService.saveToFile();
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
   * Liste tous les dossiers IMAP disponibles
   */
  async listAvailableFolders(): Promise<string[]> {
    return this.emailService.listFolders();
  }

  /**
   * Synchronisation historique depuis une date donnée
   * Inclut tous les dossiers (INBOX, SENT, et archives)
   * Traite les données par mois pour éviter les problèmes de mémoire
   */
  async historicalSync(options: {
    since?: Date;
    folders?: string[];
    batchSize?: number;
  } = {}): Promise<SyncResult> {
    if (this.isRunning) {
      this.logger.warn('Sync already running, skipping historical sync');
      return {
        accountEmail: this.accountEmail,
        folder: 'HISTORICAL',
        messagesFound: 0,
        messagesNew: 0,
        messagesSkipped: 0,
        offersDetected: 0,
        brandsMatched: 0,
        errors: ['Sync already running'],
        duration: 0,
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const since = options.since || new Date('2024-01-01');
    // No limit by default - fetch ALL emails for historical sync
    const batchSize = options.batchSize || 0; // 0 = no limit

    this.logger.log(`Starting historical sync since ${since.toISOString()} (no limit)`);

    const combinedResult: SyncResult = {
      accountEmail: this.accountEmail,
      folder: 'HISTORICAL',
      messagesFound: 0,
      messagesNew: 0,
      messagesSkipped: 0,
      offersDetected: 0,
      brandsMatched: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Déterminer les dossiers à synchroniser
      let foldersToSync: string[];
      if (options.folders && options.folders.length > 0) {
        foldersToSync = options.folders;
      } else {
        // Récupérer tous les dossiers disponibles via IMAP
        const allFolders = await this.emailService.listFolders();
        this.logger.log(`All IMAP folders: ${allFolders.join(', ')}`);

        // Filtrer pour inclure INBOX, SENT, et les archives
        // Note: les noms de dossiers sont normalisés avec /
        const relevantFolders = allFolders.filter(f => {
          const lower = f.toLowerCase();
          return (
            lower === 'inbox' ||
            lower.includes('sent') ||
            lower.includes('envoy') ||
            lower.includes('archive')
          );
        });

        // Only keep LEAF folders (folders that have no children in our list)
        // This avoids scanning empty parent folders like INBOX/Archive/2025
        // when emails are in INBOX/Archive/2025/2025-06
        // EXCEPTION: Always include INBOX itself as it contains emails directly
        foldersToSync = relevantFolders.filter(folder => {
          // Always include INBOX - it contains emails directly
          if (folder.toLowerCase() === 'inbox') {
            return true;
          }
          // For other folders, check if they have children
          const hasChildren = relevantFolders.some(other =>
            other !== folder && other.startsWith(folder + '/')
          );
          return !hasChildren;
        });
        this.logger.log(`Folders to sync: ${foldersToSync.join(', ')}`);
      }

      const logId = await this.createSyncLog('HISTORICAL', 'historical');

      this.logger.log(`Processing ${foldersToSync.length} folders since ${since.toISOString()}`);

      for (const folder of foldersToSync) {
        this.logger.log(`Processing folder: ${folder}...`);

        try {
          // Fetch all emails since the start date in one query per folder
          const folderResult = await this.syncFolderWithRetry(folder, since, batchSize);

          combinedResult.messagesFound += folderResult.messagesFound;
          combinedResult.messagesNew += folderResult.messagesNew;
          combinedResult.messagesSkipped += folderResult.messagesSkipped;
          combinedResult.offersDetected += folderResult.offersDetected;
          combinedResult.brandsMatched += folderResult.brandsMatched;
          combinedResult.errors.push(...folderResult.errors);

          this.logger.log(
            `Folder ${folder}: ${folderResult.messagesFound} found, ${folderResult.messagesNew} new, ${folderResult.offersDetected} offers`,
          );

          // Update lastSyncResult periodically for status endpoint
          this.lastSyncResult = { ...combinedResult, duration: Date.now() - startTime };

          // Add delay between folders to avoid rate limiting
          await this.delay(2000);
        } catch (error) {
          const errorMsg = `${folder}: ${error.message}`;
          combinedResult.errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      combinedResult.duration = Date.now() - startTime;
      this.lastSyncResult = combinedResult;
      await this.completeSyncLog(logId, combinedResult, 'completed');

      this.logger.log(
        `Historical sync completed in ${Math.round(combinedResult.duration / 1000)}s: ` +
        `${combinedResult.messagesNew} new emails, ${combinedResult.offersDetected} offers, ` +
        `${combinedResult.brandsMatched} brands matched`,
      );
    } finally {
      this.isRunning = false;
    }

    return combinedResult;
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sync a folder with retry logic for IMAP connection errors
   */
  private async syncFolderWithRetry(
    folder: string,
    since: Date,
    limit: number,
    maxRetries: number = 3,
  ): Promise<SyncResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.syncFolderHistoricalRange(folder, since, new Date(), limit);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Folder ${folder} sync attempt ${attempt}/${maxRetries} failed: ${error.message}`,
        );

        if (attempt < maxRetries) {
          // Exponential backoff: 2s, 4s, 8s
          const backoffMs = Math.pow(2, attempt) * 1000;
          this.logger.log(`Retrying in ${backoffMs / 1000}s...`);
          await this.delay(backoffMs);
        }
      }
    }

    throw lastError || new Error(`Failed to sync folder ${folder} after ${maxRetries} attempts`);
  }

  /**
   * Sync un dossier pour une plage de dates spécifique
   */
  private async syncFolderHistoricalRange(
    folder: string,
    since: Date,
    before: Date,
    limit: number,
  ): Promise<SyncResult> {
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

    // Convert folder path from / to . for IMAP (e.g., INBOX/Sent -> INBOX.Sent)
    const imapFolder = folder.replace(/\//g, '.');

    const fetchOptions: any = {
      folder: imapFolder,
      since,
      before,
      timeout: 300000, // 5 minute timeout per month (more time for large mailboxes)
    };

    // Only apply limit if > 0
    if (limit > 0) {
      fetchOptions.limit = limit;
    }

    const emails = await this.emailService.fetchEmails(fetchOptions);

    result.messagesFound = emails.length;

    const BATCH_SAVE_INTERVAL = 20;
    let processedSinceLastSave = 0;
    const folderType = this.determineFolderType(folder);

    for (const email of emails) {
      try {
        if (await this.isAlreadyProcessed(email.messageId || email.id)) {
          result.messagesSkipped++;
          continue;
        }

        const syncedEmail = this.convertToSyncedEmail(email, folderType);

        if (folderType === 'INBOX' && this.isInternalEmail(syncedEmail)) {
          result.messagesSkipped++;
          continue;
        }

        await this.saveEmail(syncedEmail);
        result.messagesNew++;
        processedSinceLastSave++;

        const classification = this.classifierService.classify(syncedEmail);
        await this.updateClassification(syncedEmail.id, classification);

        if (classification.classification === MessageClassification.OFFER) {
          result.offersDetected++;

          const brandMatches = this.brandMatcherService.findBrandsInEmail(syncedEmail);

          if (brandMatches.length > 0) {
            result.brandsMatched += brandMatches.length;

            const supplierEmail = this.extractSupplierEmail(syncedEmail, folderType);
            const supplierName = this.extractSupplierName(syncedEmail, folderType);

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

        if (processedSinceLastSave >= BATCH_SAVE_INTERVAL) {
          this.databaseService.saveToFile();
          processedSinceLastSave = 0;
        }
      } catch (error) {
        result.errors.push(`Email ${email.id}: ${error.message}`);
        this.logger.error(`Error processing email ${email.id}: ${error.message}`);
      }
    }

    if (processedSinceLastSave > 0) {
      this.databaseService.saveToFile();
    }

    return result;
  }

  /**
   * Détermine si un dossier est de type INBOX ou SENT
   */
  private determineFolderType(folder: string): 'INBOX' | 'SENT' {
    const lower = folder.toLowerCase();
    if (lower.includes('sent') || lower.includes('envoy')) {
      return 'SENT';
    }
    return 'INBOX';
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
    // Note: saveToFile() is called in batch by the caller, not after each email
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
    // Note: saveToFile() is called in batch by the caller, not after each update
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

  /**
   * Collecte les adresses email des fournisseurs ayant envoyé des offres positives
   * depuis une date donnée, sans filtre de dossiers (scan complet)
   * Inclut les marques associées à chaque fournisseur
   */
  async collectPositiveSupplierEmails(options: {
    since?: Date;
    minScore?: number;
  } = {}): Promise<{
    emails: string[];
    count: number;
    details: { email: string; name?: string; offerCount: number; lastSeenAt: string; brands: string[] }[];
    syncResult?: SyncResult;
  }> {
    const since = options.since || new Date('2024-01-01');
    const minScore = options.minScore ?? 3; // Score >= 3 = OFFER

    this.logger.log(`Collecting positive supplier emails since ${since.toISOString()}, minScore=${minScore}`);

    // 1. D'abord, lancer une sync historique de TOUS les dossiers
    let syncResult: SyncResult | undefined;

    if (!this.isRunning) {
      this.logger.log('Starting full historical sync for all folders...');

      // Récupérer TOUS les dossiers IMAP (sans filtre)
      const allFolders = await this.emailService.listFolders();
      this.logger.log(`Found ${allFolders.length} folders: ${allFolders.join(', ')}`);

      syncResult = await this.historicalSync({
        since,
        folders: allFolders, // TOUS les dossiers, pas de filtre
        batchSize: 0, // Pas de limite
      });
    } else {
      this.logger.warn('Sync already running, querying existing data only');
    }

    // 2. Récupérer les emails positifs depuis la base de données
    const result = this.databaseService['db'].exec(`
      SELECT
        from_email,
        from_name,
        COUNT(*) as offer_count,
        MAX(date) as last_seen_at,
        MIN(date) as first_seen_at,
        AVG(classification_score) as avg_score
      FROM supplier_emails
      WHERE classification = 'OFFER'
        AND classification_score >= ?
        AND date >= ?
        AND from_email NOT LIKE '%multipartsci.com'
        AND from_email NOT LIKE '%multiparts.ci'
      GROUP BY from_email
      ORDER BY offer_count DESC, last_seen_at DESC
    `, [minScore, since.toISOString()]);

    // 3. Récupérer les marques associées à chaque email
    const brandsResult = this.databaseService['db'].exec(`
      SELECT
        supplier_email,
        GROUP_CONCAT(DISTINCT brand_name) as brands
      FROM brand_supplier_mapping
      GROUP BY supplier_email
    `);

    // Créer un map email -> marques
    const emailBrandsMap = new Map<string, string[]>();
    if (brandsResult.length > 0 && brandsResult[0].values.length > 0) {
      for (const row of brandsResult[0].values) {
        const email = (row[0] as string).toLowerCase();
        const brands = row[1] ? (row[1] as string).split(',') : [];
        emailBrandsMap.set(email, brands);
      }
    }

    const details: { email: string; name?: string; offerCount: number; lastSeenAt: string; brands: string[] }[] = [];
    const emails: string[] = [];

    if (result.length > 0 && result[0].values.length > 0) {
      for (const row of result[0].values) {
        const email = row[0] as string;
        const name = row[1] as string | null;
        const offerCount = row[2] as number;
        const lastSeenAt = row[3] as string;

        // Récupérer les marques pour cet email
        const brands = emailBrandsMap.get(email.toLowerCase()) || [];

        emails.push(email);
        details.push({
          email,
          name: name || undefined,
          offerCount,
          lastSeenAt,
          brands,
        });
      }
    }

    this.logger.log(`Found ${emails.length} unique positive supplier emails`);

    return {
      emails,
      count: emails.length,
      details,
      syncResult,
    };
  }

  /**
   * Récupère uniquement les emails positifs déjà en base (sans sync)
   * Inclut les marques associées à chaque fournisseur
   */
  getPositiveEmailsFromDb(options: {
    since?: Date;
    minScore?: number;
  } = {}): {
    emails: string[];
    count: number;
    details: {
      email: string;
      name?: string;
      offerCount: number;
      lastSeenAt: string;
      firstSeenAt: string;
      avgScore: number;
      brands: string[];
    }[];
  } {
    const since = options.since || new Date('2024-01-01');
    const minScore = options.minScore ?? 3;

    // Récupérer les emails positifs
    const result = this.databaseService['db'].exec(`
      SELECT
        from_email,
        from_name,
        COUNT(*) as offer_count,
        MAX(date) as last_seen_at,
        MIN(date) as first_seen_at,
        AVG(classification_score) as avg_score
      FROM supplier_emails
      WHERE classification = 'OFFER'
        AND classification_score >= ?
        AND date >= ?
        AND from_email NOT LIKE '%multipartsci.com'
        AND from_email NOT LIKE '%multiparts.ci'
      GROUP BY from_email
      ORDER BY offer_count DESC, last_seen_at DESC
    `, [minScore, since.toISOString()]);

    // Récupérer les marques associées à chaque email
    const brandsResult = this.databaseService['db'].exec(`
      SELECT
        supplier_email,
        GROUP_CONCAT(DISTINCT brand_name) as brands
      FROM brand_supplier_mapping
      GROUP BY supplier_email
    `);

    // Créer un map email -> marques
    const emailBrandsMap = new Map<string, string[]>();
    if (brandsResult.length > 0 && brandsResult[0].values.length > 0) {
      for (const row of brandsResult[0].values) {
        const email = (row[0] as string).toLowerCase();
        const brands = row[1] ? (row[1] as string).split(',') : [];
        emailBrandsMap.set(email, brands);
      }
    }

    const details: {
      email: string;
      name?: string;
      offerCount: number;
      lastSeenAt: string;
      firstSeenAt: string;
      avgScore: number;
      brands: string[];
    }[] = [];
    const emails: string[] = [];

    if (result.length > 0 && result[0].values.length > 0) {
      for (const row of result[0].values) {
        const email = row[0] as string;
        const name = row[1] as string | null;
        const offerCount = row[2] as number;
        const lastSeenAt = row[3] as string;
        const firstSeenAt = row[4] as string;
        const avgScore = row[5] as number;

        // Récupérer les marques pour cet email
        const brands = emailBrandsMap.get(email.toLowerCase()) || [];

        emails.push(email);
        details.push({
          email,
          name: name || undefined,
          offerCount,
          lastSeenAt,
          firstSeenAt,
          avgScore: Math.round(avgScore * 100) / 100,
          brands,
        });
      }
    }

    return {
      emails,
      count: emails.length,
      details,
    };
  }
}
