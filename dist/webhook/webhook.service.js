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
var WebhookService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = exports.WebhookEventType = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const fs = require("fs");
const path = require("path");
var WebhookEventType;
(function (WebhookEventType) {
    WebhookEventType["RFQ_RECEIVED"] = "rfq.received";
    WebhookEventType["RFQ_PROCESSED"] = "rfq.processed";
    WebhookEventType["RFQ_PROCESSING_ERROR"] = "rfq.processing_error";
    WebhookEventType["ACKNOWLEDGMENT_SENT"] = "acknowledgment.sent";
    WebhookEventType["ACKNOWLEDGMENT_FAILED"] = "acknowledgment.failed";
    WebhookEventType["RFQ_SENT_TO_SUPPLIER"] = "rfq.sent_to_supplier";
    WebhookEventType["SUPPLIER_CONSULTED"] = "supplier.consulted";
    WebhookEventType["QUOTE_RECEIVED"] = "quote.received";
    WebhookEventType["QUOTE_DECLINED"] = "quote.declined";
    WebhookEventType["QUOTE_NEEDS_REVIEW"] = "quote.needs_review";
    WebhookEventType["COMPARISON_CREATED"] = "comparison.created";
    WebhookEventType["COMPARISON_UPDATED"] = "comparison.updated";
    WebhookEventType["COMPARISON_COMPLETE"] = "comparison.complete";
    WebhookEventType["REMINDER_SENT"] = "reminder.sent";
    WebhookEventType["REMINDER_FAILED"] = "reminder.failed";
    WebhookEventType["REMINDER_MAX_REACHED"] = "reminder.max_reached";
    WebhookEventType["RFQ_STATUS_CHANGED"] = "rfq.status_changed";
    WebhookEventType["DEADLINE_APPROACHING"] = "deadline.approaching";
    WebhookEventType["DEADLINE_PASSED"] = "deadline.passed";
    WebhookEventType["SYSTEM_ERROR"] = "system.error";
    WebhookEventType["DAILY_SUMMARY"] = "daily.summary";
})(WebhookEventType || (exports.WebhookEventType = WebhookEventType = {}));
let WebhookService = WebhookService_1 = class WebhookService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(WebhookService_1.name);
        this.endpoints = [];
        this.httpClient = axios_1.default.create({
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MultipartsCI-RFQ-Processor/1.0',
            },
        });
        const dataDir = this.configService.get('app.outputDir', './output');
        this.configFilePath = path.join(dataDir, 'webhook-config.json');
        this.logFilePath = path.join(dataDir, 'webhook-log.json');
        this.loadEndpoints();
    }
    loadEndpoints() {
        try {
            if (fs.existsSync(this.configFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.configFilePath, 'utf-8'));
                this.endpoints = data.endpoints || [];
            }
            const defaultUrl = this.configService.get('webhook.defaultUrl');
            if (defaultUrl && !this.endpoints.find(e => e.url === defaultUrl)) {
                this.endpoints.push({
                    id: 'default',
                    url: defaultUrl,
                    secret: this.configService.get('webhook.secret'),
                    events: '*',
                    enabled: true,
                    retryCount: 3,
                });
            }
            this.logger.log(`${this.endpoints.filter(e => e.enabled).length} endpoint(s) webhook configuré(s)`);
        }
        catch (error) {
            this.logger.warn(`Erreur chargement config webhook: ${error.message}`);
        }
    }
    saveEndpoints() {
        try {
            const dir = path.dirname(this.configFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configFilePath, JSON.stringify({ endpoints: this.endpoints }, null, 2));
        }
        catch (error) {
            this.logger.error(`Erreur sauvegarde config webhook: ${error.message}`);
        }
    }
    addEndpoint(endpoint) {
        const id = `webhook_${Date.now()}`;
        this.endpoints.push({ ...endpoint, id });
        this.saveEndpoints();
        this.logger.log(`Endpoint webhook ajouté: ${id} → ${endpoint.url}`);
        return id;
    }
    removeEndpoint(id) {
        const index = this.endpoints.findIndex(e => e.id === id);
        if (index >= 0) {
            this.endpoints.splice(index, 1);
            this.saveEndpoints();
            return true;
        }
        return false;
    }
    toggleEndpoint(id, enabled) {
        const endpoint = this.endpoints.find(e => e.id === id);
        if (endpoint) {
            endpoint.enabled = enabled;
            this.saveEndpoints();
            return true;
        }
        return false;
    }
    listEndpoints() {
        return this.endpoints;
    }
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    createSignature(payload, secret) {
        const crypto = require('crypto');
        return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }
    async emit(type, data, metadata) {
        const event = {
            id: this.generateEventId(),
            type,
            timestamp: new Date(),
            data,
            metadata,
        };
        const results = [];
        const targetEndpoints = this.endpoints.filter(ep => {
            if (!ep.enabled)
                return false;
            if (ep.events === '*')
                return true;
            return ep.events.includes(type);
        });
        if (targetEndpoints.length === 0) {
            this.logger.debug(`Aucun endpoint pour l'événement ${type}`);
            return results;
        }
        for (const endpoint of targetEndpoints) {
            const result = await this.sendToEndpoint(endpoint, event);
            results.push(result);
        }
        this.logEvent(event, results);
        return results;
    }
    async sendToEndpoint(endpoint, event) {
        const startTime = Date.now();
        const payload = JSON.stringify(event);
        const maxRetries = endpoint.retryCount || 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const headers = {
                    ...endpoint.headers,
                    'X-Webhook-Event': event.type,
                    'X-Webhook-ID': event.id,
                    'X-Webhook-Timestamp': event.timestamp.toISOString(),
                };
                if (endpoint.secret) {
                    headers['X-Webhook-Signature'] = this.createSignature(payload, endpoint.secret);
                }
                const response = await this.httpClient.post(endpoint.url, event, { headers });
                this.logger.log(`✅ Webhook envoyé: ${event.type} → ${endpoint.url} (${response.status})`);
                return {
                    endpointId: endpoint.id,
                    success: true,
                    statusCode: response.status,
                    duration: Date.now() - startTime,
                };
            }
            catch (error) {
                const statusCode = error.response?.status;
                const errorMessage = error.message;
                if (attempt < maxRetries) {
                    this.logger.warn(`Webhook retry ${attempt}/${maxRetries}: ${endpoint.url} - ${errorMessage}`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                else {
                    this.logger.error(`❌ Webhook échoué après ${maxRetries} tentatives: ${endpoint.url}`);
                    return {
                        endpointId: endpoint.id,
                        success: false,
                        statusCode,
                        error: errorMessage,
                        duration: Date.now() - startTime,
                    };
                }
            }
        }
        return {
            endpointId: endpoint.id,
            success: false,
            error: 'Max retries exceeded',
            duration: Date.now() - startTime,
        };
    }
    logEvent(event, results) {
        try {
            let logs = [];
            if (fs.existsSync(this.logFilePath)) {
                logs = JSON.parse(fs.readFileSync(this.logFilePath, 'utf-8'));
            }
            if (logs.length >= 1000) {
                logs = logs.slice(-900);
            }
            logs.push({
                event,
                results,
                timestamp: new Date().toISOString(),
            });
            fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));
        }
        catch (error) {
            this.logger.debug(`Erreur log webhook: ${error.message}`);
        }
    }
    getEventHistory(limit = 100) {
        try {
            if (fs.existsSync(this.logFilePath)) {
                const logs = JSON.parse(fs.readFileSync(this.logFilePath, 'utf-8'));
                return logs.slice(-limit).reverse();
            }
        }
        catch (error) {
            this.logger.debug(`Erreur lecture log webhook: ${error.message}`);
        }
        return [];
    }
    async emitRfqReceived(rfqNumber, clientEmail, subject, itemCount) {
        await this.emit(WebhookEventType.RFQ_RECEIVED, {
            rfqNumber,
            clientEmail,
            subject,
            itemCount,
            receivedAt: new Date().toISOString(),
        }, { rfqNumber, clientEmail });
    }
    async emitRfqProcessed(rfqNumber, clientRfqNumber, itemCount, filePath) {
        await this.emit(WebhookEventType.RFQ_PROCESSED, {
            rfqNumber,
            clientRfqNumber,
            itemCount,
            filePath,
            processedAt: new Date().toISOString(),
        }, { rfqNumber, filePath });
    }
    async emitAcknowledgmentSent(rfqNumber, recipients) {
        await this.emit(WebhookEventType.ACKNOWLEDGMENT_SENT, {
            rfqNumber,
            recipients,
            sentAt: new Date().toISOString(),
        }, { rfqNumber });
    }
    async emitQuoteReceived(rfqNumber, supplierEmail, supplierName, totalAmount, currency) {
        await this.emit(WebhookEventType.QUOTE_RECEIVED, {
            rfqNumber,
            supplierEmail,
            supplierName,
            totalAmount,
            currency,
            receivedAt: new Date().toISOString(),
        }, { rfqNumber, supplierEmail });
    }
    async emitQuoteDeclined(rfqNumber, supplierEmail) {
        await this.emit(WebhookEventType.QUOTE_DECLINED, {
            rfqNumber,
            supplierEmail,
            declinedAt: new Date().toISOString(),
        }, { rfqNumber, supplierEmail });
    }
    async emitComparisonCreated(rfqNumber, filePath, supplierCount) {
        await this.emit(WebhookEventType.COMPARISON_CREATED, {
            rfqNumber,
            filePath,
            supplierCount,
            createdAt: new Date().toISOString(),
        }, { rfqNumber, filePath });
    }
    async emitComparisonUpdated(rfqNumber, filePath, supplierCount, newSupplier) {
        await this.emit(WebhookEventType.COMPARISON_UPDATED, {
            rfqNumber,
            filePath,
            supplierCount,
            newSupplier,
            updatedAt: new Date().toISOString(),
        }, { rfqNumber, filePath, supplierEmail: newSupplier });
    }
    async emitComparisonComplete(rfqNumber, filePath, recommendation) {
        await this.emit(WebhookEventType.COMPARISON_COMPLETE, {
            rfqNumber,
            filePath,
            recommendation,
            completedAt: new Date().toISOString(),
        }, { rfqNumber, filePath });
    }
    async emitReminderSent(rfqNumber, supplierEmail, reminderCount) {
        await this.emit(WebhookEventType.REMINDER_SENT, {
            rfqNumber,
            supplierEmail,
            reminderCount,
            sentAt: new Date().toISOString(),
        }, { rfqNumber, supplierEmail });
    }
    async emitRfqStatusChanged(rfqNumber, oldStatus, newStatus) {
        await this.emit(WebhookEventType.RFQ_STATUS_CHANGED, {
            rfqNumber,
            oldStatus,
            newStatus,
            changedAt: new Date().toISOString(),
        }, { rfqNumber });
    }
    async emitDeadlineApproaching(rfqNumber, deadline, hoursRemaining) {
        await this.emit(WebhookEventType.DEADLINE_APPROACHING, {
            rfqNumber,
            deadline: deadline.toISOString(),
            hoursRemaining,
        }, { rfqNumber });
    }
    async emitDailySummary(stats) {
        await this.emit(WebhookEventType.DAILY_SUMMARY, {
            date: new Date().toISOString().split('T')[0],
            stats,
        });
    }
    async emitSystemError(error, context) {
        await this.emit(WebhookEventType.SYSTEM_ERROR, {
            error,
            context,
            timestamp: new Date().toISOString(),
        });
    }
};
exports.WebhookService = WebhookService;
exports.WebhookService = WebhookService = WebhookService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], WebhookService);
//# sourceMappingURL=webhook.service.js.map