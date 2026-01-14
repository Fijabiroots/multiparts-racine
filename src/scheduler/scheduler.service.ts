import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { DetectorService } from '../detector/detector.service';
import { AutoProcessorService, ProcessResult } from './auto-processor.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private isProcessing = false;
  private isActive = false;
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMinutes = 5; // Défaut: 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
    private readonly detectorService: DetectorService,
    private readonly autoProcessor: AutoProcessorService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    await this.initializeScheduler();
  }

  private async initializeScheduler() {
    const config = await this.databaseService.getProcessingConfig();
    
    if (config?.isActive) {
      this.intervalMinutes = config.checkIntervalMinutes || 5;
      this.startInterval();
      this.logger.log(`Scheduler initialisé avec intervalle de ${this.intervalMinutes} minutes`);
    } else {
      this.logger.log('Scheduler désactivé dans la configuration');
    }
  }

  private startInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    this.isActive = true;
    const intervalMs = this.intervalMinutes * 60 * 1000;
    
    this.intervalId = setInterval(async () => {
      if (this.isActive) {
        await this.runFullCycle();
      }
    }, intervalMs);
    
    this.logger.log(`Scheduler configuré pour s'exécuter toutes les ${this.intervalMinutes} minutes`);
  }

  /**
   * Cycle complet: traiter les nouveaux emails ET envoyer les brouillons en attente
   */
  private async runFullCycle(): Promise<void> {
    // 1. Traiter les nouveaux emails
    await this.processEmails();
    
    // 2. Envoyer les brouillons en attente (après le délai)
    await this.sendPendingDrafts();
  }

  updateScheduleInterval(minutes: number) {
    this.intervalMinutes = minutes;
    if (this.isActive) {
      this.startInterval();
    }
  }

  async startScheduler(): Promise<boolean> {
    this.startInterval();
    return true;
  }

  async stopScheduler(): Promise<boolean> {
    this.isActive = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.log('Scheduler arrêté');
    return true;
  }

  async processEmails(): Promise<ProcessResult | { skipped: true; reason: string } | { error: string }> {
    if (this.isProcessing) {
      this.logger.warn('Traitement déjà en cours, ignoré');
      return { skipped: true, reason: 'Traitement en cours' };
    }

    this.isProcessing = true;
    this.logger.log('Début du traitement automatique des emails');

    try {
      const config = await this.databaseService.getProcessingConfig();
      
      if (!config?.isActive) {
        this.logger.log('Traitement désactivé dans la configuration');
        return { skipped: true, reason: 'Traitement désactivé' };
      }

      const result = await this.autoProcessor.processNewEmails({
        endDate: config.endDate,
        folders: config.folders,
        autoSendDraft: config.autoSendDraft,
      });

      await this.databaseService.updateProcessingConfig({
        lastProcessedAt: new Date(),
      });

      this.logger.log(`Traitement terminé: ${result.processed} emails traités, ${result.successful} réussis`);
      return result;

    } catch (error) {
      this.logger.error('Erreur traitement automatique:', error.message);
      return { error: error.message };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Envoyer automatiquement les brouillons en attente dont le délai est écoulé
   */
  async sendPendingDrafts(): Promise<{ sent: number; failed: number; errors: string[] }> {
    const result = { sent: 0, failed: 0, errors: [] as string[] };

    try {
      const pendingDrafts = await this.databaseService.getPendingDraftsToSend();
      
      if (pendingDrafts.length === 0) {
        this.logger.debug('Aucun brouillon en attente à envoyer');
        return result;
      }

      this.logger.log(`${pendingDrafts.length} brouillon(s) en attente à envoyer`);

      for (const draft of pendingDrafts) {
        try {
          // Envoyer l'email
          const sendResult = await this.mailService.sendPriceRequestEmail({
            recipient: draft.recipient,
            subject: draft.subject,
            internalRfqNumber: draft.internalRfqNumber,
            clientRfqNumber: draft.clientRfqNumber,
            clientName: draft.clientName,
            clientEmail: draft.clientEmail,
            excelPath: draft.excelPath,
            attachmentPaths: draft.attachmentPaths,
          });

          if (sendResult.success) {
            // Mettre à jour le statut du brouillon
            await this.databaseService.updateDraftStatus(draft.id, 'sent');
            
            // Logger l'envoi
            await this.databaseService.addOutputLog({
              draftId: draft.id,
              rfqMappingId: draft.rfqMappingId,
              internalRfqNumber: draft.internalRfqNumber,
              clientRfqNumber: draft.clientRfqNumber,
              clientName: draft.clientName,
              recipient: draft.recipient,
              subject: draft.subject,
              excelPath: draft.excelPath,
              attachmentCount: 1 + (draft.attachmentPaths?.length || 0),
              action: 'email_sent',
              status: 'success',
            });

            result.sent++;
            this.logger.log(`Email envoyé: ${draft.internalRfqNumber} -> ${draft.recipient}`);
          } else {
            // Marquer comme échoué
            await this.databaseService.updateDraftStatus(draft.id, 'failed', sendResult.error);
            
            // Logger l'échec
            await this.databaseService.addOutputLog({
              draftId: draft.id,
              internalRfqNumber: draft.internalRfqNumber,
              recipient: draft.recipient,
              subject: draft.subject,
              action: 'send_failed',
              status: 'failed',
              errorMessage: sendResult.error,
            });

            result.failed++;
            result.errors.push(`${draft.internalRfqNumber}: ${sendResult.error}`);
            this.logger.error(`Échec envoi ${draft.internalRfqNumber}: ${sendResult.error}`);
          }
        } catch (error) {
          await this.databaseService.updateDraftStatus(draft.id, 'failed', error.message);
          result.failed++;
          result.errors.push(`${draft.internalRfqNumber}: ${error.message}`);
          this.logger.error(`Erreur envoi ${draft.internalRfqNumber}:`, error.message);
        }
      }

      this.logger.log(`Envoi terminé: ${result.sent} envoyés, ${result.failed} échoués`);
      return result;

    } catch (error) {
      this.logger.error('Erreur envoi brouillons:', error.message);
      result.errors.push(error.message);
      return result;
    }
  }

  async runOnce(): Promise<ProcessResult | { skipped: true; reason: string } | { error: string }> {
    const emailResult = await this.processEmails();
    
    // Aussi envoyer les brouillons en attente
    const draftResult = await this.sendPendingDrafts();
    
    return {
      ...emailResult,
      draftsSent: draftResult.sent,
      draftsFailed: draftResult.failed,
    } as any;
  }

  getStatus() {
    return {
      isRunning: this.isActive,
      isProcessing: this.isProcessing,
      intervalMinutes: this.intervalMinutes,
      nextExecution: this.isActive ? new Date(Date.now() + this.intervalMinutes * 60 * 1000) : null,
    };
  }

  /**
   * Retraitement exceptionnel des emails sur une plage de dates
   * Utilisé pour le retraitement janvier 2026
   */
  async reprocessDateRange(
    startDate: Date,
    endDate: Date,
    folders: string[] = ['INBOX'],
  ): Promise<ProcessResult | { error: string }> {
    if (this.isProcessing) {
      this.logger.warn('Traitement déjà en cours, retraitement ignoré');
      return { error: 'Traitement en cours' };
    }

    this.isProcessing = true;
    this.logger.log(`=== RETRAITEMENT EXCEPTIONNEL ===`);
    this.logger.log(`Période: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    this.logger.log(`Dossiers: ${folders.join(', ')}`);

    try {
      const result = await this.autoProcessor.processNewEmails({
        startDate,
        endDate,
        folders,
        autoSendDraft: true,
      });

      this.logger.log(`=== RETRAITEMENT TERMINE ===`);
      this.logger.log(`Traités: ${result.processed}, Réussis: ${result.successful}, Échecs: ${result.failed}, Ignorés: ${result.skipped}`);

      return result;

    } catch (error) {
      this.logger.error('Erreur retraitement:', error.message);
      return { error: error.message };
    } finally {
      this.isProcessing = false;
    }
  }
}
