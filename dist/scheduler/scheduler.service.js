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
var SchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const config_1 = require("@nestjs/config");
const database_service_1 = require("../database/database.service");
const email_service_1 = require("../email/email.service");
const detector_service_1 = require("../detector/detector.service");
const auto_processor_service_1 = require("./auto-processor.service");
const mail_service_1 = require("../mail/mail.service");
let SchedulerService = SchedulerService_1 = class SchedulerService {
    constructor(configService, databaseService, emailService, detectorService, autoProcessor, schedulerRegistry, mailService) {
        this.configService = configService;
        this.databaseService = databaseService;
        this.emailService = emailService;
        this.detectorService = detectorService;
        this.autoProcessor = autoProcessor;
        this.schedulerRegistry = schedulerRegistry;
        this.mailService = mailService;
        this.logger = new common_1.Logger(SchedulerService_1.name);
        this.isProcessing = false;
        this.isActive = false;
        this.intervalId = null;
        this.intervalMinutes = 5;
    }
    async onModuleInit() {
        await this.initializeScheduler();
    }
    async initializeScheduler() {
        const config = await this.databaseService.getProcessingConfig();
        if (config?.isActive) {
            this.intervalMinutes = config.checkIntervalMinutes || 5;
            this.startInterval();
            this.logger.log(`Scheduler initialisé avec intervalle de ${this.intervalMinutes} minutes`);
        }
        else {
            this.logger.log('Scheduler désactivé dans la configuration');
        }
    }
    startInterval() {
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
    async runFullCycle() {
        await this.processEmails();
        await this.sendPendingDrafts();
    }
    updateScheduleInterval(minutes) {
        this.intervalMinutes = minutes;
        if (this.isActive) {
            this.startInterval();
        }
    }
    async startScheduler() {
        this.startInterval();
        return true;
    }
    async stopScheduler() {
        this.isActive = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.logger.log('Scheduler arrêté');
        return true;
    }
    async processEmails() {
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
        }
        catch (error) {
            this.logger.error('Erreur traitement automatique:', error.message);
            return { error: error.message };
        }
        finally {
            this.isProcessing = false;
        }
    }
    async sendPendingDrafts() {
        const result = { sent: 0, failed: 0, errors: [] };
        try {
            const pendingDrafts = await this.databaseService.getPendingDraftsToSend();
            if (pendingDrafts.length === 0) {
                this.logger.debug('Aucun brouillon en attente à envoyer');
                return result;
            }
            this.logger.log(`${pendingDrafts.length} brouillon(s) en attente à envoyer`);
            for (const draft of pendingDrafts) {
                try {
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
                        await this.databaseService.updateDraftStatus(draft.id, 'sent');
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
                    }
                    else {
                        await this.databaseService.updateDraftStatus(draft.id, 'failed', sendResult.error);
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
                }
                catch (error) {
                    await this.databaseService.updateDraftStatus(draft.id, 'failed', error.message);
                    result.failed++;
                    result.errors.push(`${draft.internalRfqNumber}: ${error.message}`);
                    this.logger.error(`Erreur envoi ${draft.internalRfqNumber}:`, error.message);
                }
            }
            this.logger.log(`Envoi terminé: ${result.sent} envoyés, ${result.failed} échoués`);
            return result;
        }
        catch (error) {
            this.logger.error('Erreur envoi brouillons:', error.message);
            result.errors.push(error.message);
            return result;
        }
    }
    async runOnce() {
        const emailResult = await this.processEmails();
        const draftResult = await this.sendPendingDrafts();
        return {
            ...emailResult,
            draftsSent: draftResult.sent,
            draftsFailed: draftResult.failed,
        };
    }
    getStatus() {
        return {
            isRunning: this.isActive,
            isProcessing: this.isProcessing,
            intervalMinutes: this.intervalMinutes,
            nextExecution: this.isActive ? new Date(Date.now() + this.intervalMinutes * 60 * 1000) : null,
        };
    }
};
exports.SchedulerService = SchedulerService;
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        database_service_1.DatabaseService,
        email_service_1.EmailService,
        detector_service_1.DetectorService,
        auto_processor_service_1.AutoProcessorService,
        schedule_1.SchedulerRegistry,
        mail_service_1.MailService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map