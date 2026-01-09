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
exports.WebhookController = void 0;
const common_1 = require("@nestjs/common");
const webhook_service_1 = require("./webhook.service");
let WebhookController = class WebhookController {
    constructor(webhookService) {
        this.webhookService = webhookService;
    }
    listEndpoints() {
        const endpoints = this.webhookService.listEndpoints();
        return {
            success: true,
            count: endpoints.length,
            data: endpoints.map(ep => ({
                ...ep,
                secret: ep.secret ? '***' : undefined,
            })),
        };
    }
    addEndpoint(body) {
        if (!body.url) {
            return { success: false, error: 'URL requise' };
        }
        const id = this.webhookService.addEndpoint({
            url: body.url,
            secret: body.secret,
            events: body.events || '*',
            enabled: body.enabled !== false,
            headers: body.headers,
            retryCount: 3,
        });
        return {
            success: true,
            message: 'Endpoint ajouté',
            data: { id, url: body.url },
        };
    }
    removeEndpoint(id) {
        const success = this.webhookService.removeEndpoint(id);
        return {
            success,
            message: success ? 'Endpoint supprimé' : 'Endpoint non trouvé',
        };
    }
    toggleEndpoint(id, body) {
        const success = this.webhookService.toggleEndpoint(id, body.enabled);
        return {
            success,
            message: success ? `Endpoint ${body.enabled ? 'activé' : 'désactivé'}` : 'Endpoint non trouvé',
        };
    }
    listEventTypes() {
        return {
            success: true,
            data: Object.values(webhook_service_1.WebhookEventType).map(type => ({
                type,
                category: type.split('.')[0],
                description: this.getEventDescription(type),
            })),
        };
    }
    getHistory(limit) {
        const history = this.webhookService.getEventHistory(limit ? parseInt(limit, 10) : 100);
        return {
            success: true,
            count: history.length,
            data: history,
        };
    }
    async testWebhook(body) {
        const results = await this.webhookService.emit(webhook_service_1.WebhookEventType.RFQ_RECEIVED, {
            rfqNumber: 'TEST-001',
            clientEmail: 'test@example.com',
            subject: 'Test Webhook - Demande de prix',
            itemCount: 5,
            receivedAt: new Date().toISOString(),
            isTest: true,
        }, { rfqNumber: 'TEST-001' });
        return {
            success: true,
            message: 'Événement de test envoyé',
            results: results.map(r => ({
                endpointId: r.endpointId,
                success: r.success,
                statusCode: r.statusCode,
                duration: r.duration,
                error: r.error,
            })),
        };
    }
    getEventDescription(type) {
        const descriptions = {
            [webhook_service_1.WebhookEventType.RFQ_RECEIVED]: 'Nouvelle demande client reçue',
            [webhook_service_1.WebhookEventType.RFQ_PROCESSED]: 'Demande traitée avec succès',
            [webhook_service_1.WebhookEventType.RFQ_PROCESSING_ERROR]: 'Erreur lors du traitement',
            [webhook_service_1.WebhookEventType.ACKNOWLEDGMENT_SENT]: 'Accusé de réception envoyé au client',
            [webhook_service_1.WebhookEventType.ACKNOWLEDGMENT_FAILED]: 'Échec envoi accusé de réception',
            [webhook_service_1.WebhookEventType.RFQ_SENT_TO_SUPPLIER]: 'Demande envoyée à un fournisseur',
            [webhook_service_1.WebhookEventType.SUPPLIER_CONSULTED]: 'Nouveau fournisseur consulté',
            [webhook_service_1.WebhookEventType.QUOTE_RECEIVED]: 'Offre fournisseur reçue',
            [webhook_service_1.WebhookEventType.QUOTE_DECLINED]: 'Fournisseur a décliné la demande',
            [webhook_service_1.WebhookEventType.QUOTE_NEEDS_REVIEW]: 'Offre nécessite révision manuelle',
            [webhook_service_1.WebhookEventType.COMPARISON_CREATED]: 'Tableau comparatif créé',
            [webhook_service_1.WebhookEventType.COMPARISON_UPDATED]: 'Tableau comparatif mis à jour',
            [webhook_service_1.WebhookEventType.COMPARISON_COMPLETE]: 'Toutes les offres reçues',
            [webhook_service_1.WebhookEventType.REMINDER_SENT]: 'Relance envoyée au fournisseur',
            [webhook_service_1.WebhookEventType.REMINDER_FAILED]: 'Échec envoi relance',
            [webhook_service_1.WebhookEventType.REMINDER_MAX_REACHED]: 'Nombre maximum de relances atteint',
            [webhook_service_1.WebhookEventType.RFQ_STATUS_CHANGED]: 'Changement de statut de la demande',
            [webhook_service_1.WebhookEventType.DEADLINE_APPROACHING]: 'Deadline proche (moins de 24h)',
            [webhook_service_1.WebhookEventType.DEADLINE_PASSED]: 'Deadline dépassée',
            [webhook_service_1.WebhookEventType.SYSTEM_ERROR]: 'Erreur système',
            [webhook_service_1.WebhookEventType.DAILY_SUMMARY]: 'Résumé quotidien',
        };
        return descriptions[type] || type;
    }
};
exports.WebhookController = WebhookController;
__decorate([
    (0, common_1.Get)('endpoints'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "listEndpoints", null);
__decorate([
    (0, common_1.Post)('endpoints'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "addEndpoint", null);
__decorate([
    (0, common_1.Delete)('endpoints/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "removeEndpoint", null);
__decorate([
    (0, common_1.Post)('endpoints/:id/toggle'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "toggleEndpoint", null);
__decorate([
    (0, common_1.Get)('events'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "listEventTypes", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WebhookController.prototype, "testWebhook", null);
exports.WebhookController = WebhookController = __decorate([
    (0, common_1.Controller)('webhooks'),
    __metadata("design:paramtypes", [webhook_service_1.WebhookService])
], WebhookController);
//# sourceMappingURL=webhook.controller.js.map