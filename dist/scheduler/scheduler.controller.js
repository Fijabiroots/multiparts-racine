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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerController = void 0;
const common_1 = require("@nestjs/common");
const scheduler_service_1 = require("./scheduler.service");
const auto_processor_service_1 = require("./auto-processor.service");
const database_service_1 = require("../database/database.service");
let SchedulerController = class SchedulerController {
    constructor(schedulerService, autoProcessor, databaseService) {
        this.schedulerService = schedulerService;
        this.autoProcessor = autoProcessor;
        this.databaseService = databaseService;
    }
    async getStatus() {
        const status = this.schedulerService.getStatus();
        const config = await this.databaseService.getProcessingConfig();
        return {
            ...status,
            config: config ? {
                isActive: config.isActive,
                checkIntervalMinutes: config.checkIntervalMinutes,
                folders: config.folders,
                endDate: config.endDate,
                lastProcessedAt: config.lastProcessedAt,
                autoSendDraft: config.autoSendDraft,
            } : null,
        };
    }
    async start() {
        await this.databaseService.updateProcessingConfig({ isActive: true });
        const success = await this.schedulerService.startScheduler();
        return { success, message: success ? 'Scheduler démarré' : 'Erreur démarrage' };
    }
    async stop() {
        await this.databaseService.updateProcessingConfig({ isActive: false });
        const success = await this.schedulerService.stopScheduler();
        return { success, message: success ? 'Scheduler arrêté' : 'Erreur arrêt' };
    }
    async runOnce() {
        const result = await this.schedulerService.runOnce();
        return result;
    }
    async updateConfig(body) {
        await this.databaseService.updateProcessingConfig({
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            folders: body.folders,
            checkIntervalMinutes: body.checkIntervalMinutes,
            autoSendDraft: body.autoSendDraft,
        });
        if (body.checkIntervalMinutes) {
            this.schedulerService.updateScheduleInterval(body.checkIntervalMinutes);
        }
        const config = await this.databaseService.getProcessingConfig();
        return { success: true, config };
    }
    async configure(body) {
        await this.databaseService.updateProcessingConfig({
            endDate: new Date(body.endDate),
            folders: body.folders || ['INBOX'],
            checkIntervalMinutes: body.checkIntervalMinutes || 5,
            autoSendDraft: body.autoSendDraft !== false,
            isActive: body.startImmediately !== false,
        });
        const config = await this.databaseService.getProcessingConfig();
        if (body.startImmediately !== false && config) {
            this.schedulerService.updateScheduleInterval(config.checkIntervalMinutes);
            await this.schedulerService.startScheduler();
        }
        return {
            success: true,
            message: body.startImmediately !== false
                ? 'Configuration appliquée et scheduler démarré'
                : 'Configuration appliquée (scheduler non démarré)',
            config,
        };
    }
    async getOutputLogs(limit, status) {
        const logs = await this.databaseService.getOutputLogs(limit ? parseInt(limit, 10) : 100, status);
        const summary = await this.databaseService.getOutputLogsSummary();
        return {
            summary,
            logs,
        };
    }
    async getOutputLogsSummary() {
        return this.databaseService.getOutputLogsSummary();
    }
    async getDrafts(status, limit) {
        const drafts = await this.databaseService.getAllDrafts(status, limit ? parseInt(limit, 10) : 50);
        return { count: drafts.length, drafts };
    }
    async getPendingDrafts() {
        const drafts = await this.databaseService.getPendingDraftsToSend();
        return { count: drafts.length, drafts };
    }
    async getDraftById(id) {
        const draft = await this.databaseService.getDraftById(id);
        if (!draft) {
            return { success: false, error: 'Brouillon non trouvé' };
        }
        return { success: true, draft };
    }
    async cancelDraft(id) {
        await this.databaseService.updateDraftStatus(id, 'cancelled');
        return { success: true, message: 'Brouillon annulé' };
    }
    async sendPendingDraftsNow() {
        const result = await this.schedulerService.sendPendingDrafts();
        return {
            success: true,
            sent: result.sent,
            failed: result.failed,
            errors: result.errors,
        };
    }
    async getKnownSuppliers() {
        const suppliers = await this.databaseService.getAllKnownSuppliers();
        return { count: suppliers.length, suppliers };
    }
    async addKnownSupplier(body) {
        await this.databaseService.addKnownSupplier(body.name, body.email);
        return { success: true, message: `Fournisseur ${body.name} ajouté` };
    }
    async removeKnownSupplier(id) {
        await this.databaseService.removeKnownSupplier(id);
        return { success: true, message: 'Fournisseur supprimé' };
    }
    async getProcessingLogs(limit) {
        const logs = await this.databaseService.getProcessingLogs(limit ? parseInt(limit, 10) : 100);
        return { count: logs.length, logs };
    }
};
exports.SchedulerController = SchedulerController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('start'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "start", null);
__decorate([
    (0, common_1.Post)('stop'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "stop", null);
__decorate([
    (0, common_1.Post)('run-once'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "runOnce", null);
__decorate([
    (0, common_1.Put)('config'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Post)('configure'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "configure", null);
__decorate([
    (0, common_1.Get)('output-logs'),
    __param(0, (0, common_1.Query)('limit')),
    __param(1, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getOutputLogs", null);
__decorate([
    (0, common_1.Get)('output-logs/summary'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getOutputLogsSummary", null);
__decorate([
    (0, common_1.Get)('drafts'),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getDrafts", null);
__decorate([
    (0, common_1.Get)('drafts/pending'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getPendingDrafts", null);
__decorate([
    (0, common_1.Get)('drafts/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getDraftById", null);
__decorate([
    (0, common_1.Post)('drafts/:id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "cancelDraft", null);
__decorate([
    (0, common_1.Post)('drafts/send-now'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "sendPendingDraftsNow", null);
__decorate([
    (0, common_1.Get)('suppliers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getKnownSuppliers", null);
__decorate([
    (0, common_1.Post)('suppliers'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "addKnownSupplier", null);
__decorate([
    (0, common_1.Delete)('suppliers/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "removeKnownSupplier", null);
__decorate([
    (0, common_1.Get)('processing-logs'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SchedulerController.prototype, "getProcessingLogs", null);
exports.SchedulerController = SchedulerController = __decorate([
    (0, common_1.Controller)('scheduler'),
    __metadata("design:paramtypes", [scheduler_service_1.SchedulerService,
        auto_processor_service_1.AutoProcessorService,
        database_service_1.DatabaseService])
], SchedulerController);
//# sourceMappingURL=scheduler.controller.js.map