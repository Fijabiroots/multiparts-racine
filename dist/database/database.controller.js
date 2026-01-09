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
exports.DatabaseController = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
let DatabaseController = class DatabaseController {
    constructor(databaseService) {
        this.databaseService = databaseService;
    }
    async getAllClients() {
        const clients = await this.databaseService.getAllClients();
        return { count: clients.length, clients };
    }
    async getClient(id) {
        const client = await this.databaseService.getClientById(id);
        if (!client) {
            return { error: 'Client non trouvé' };
        }
        return client;
    }
    async getClientByEmail(email) {
        const client = await this.databaseService.getClientByEmail(email);
        if (!client) {
            return { error: 'Client non trouvé' };
        }
        return client;
    }
    async createClient(body) {
        const client = await this.databaseService.createClient(body);
        return { success: true, client };
    }
    async updateClient(id, body) {
        const client = await this.databaseService.updateClient(id, body);
        if (!client) {
            return { error: 'Client non trouvé' };
        }
        return { success: true, client };
    }
    async getAllRfqMappings(limit) {
        const mappings = await this.databaseService.getAllRfqMappings(limit ? parseInt(limit, 10) : 100);
        return { count: mappings.length, mappings };
    }
    async getRfqMapping(id) {
        const mapping = await this.databaseService.getRfqMappingById(id);
        if (!mapping) {
            return { error: 'Mapping non trouvé' };
        }
        return mapping;
    }
    async getRfqMappingByClientRfq(rfqNumber) {
        const mapping = await this.databaseService.getRfqMappingByClientRfq(rfqNumber);
        if (!mapping) {
            return { error: 'Mapping non trouvé' };
        }
        return mapping;
    }
    async getRfqMappingByInternalRfq(rfqNumber) {
        const mapping = await this.databaseService.getRfqMappingByInternalRfq(rfqNumber);
        if (!mapping) {
            return { error: 'Mapping non trouvé' };
        }
        return mapping;
    }
    async getClientRfqMappings(clientId) {
        const mappings = await this.databaseService.getClientRfqMappings(clientId);
        return { count: mappings.length, mappings };
    }
    async getConfig() {
        const config = await this.databaseService.getProcessingConfig();
        return config || { error: 'Configuration non trouvée' };
    }
    async updateConfig(body) {
        await this.databaseService.updateProcessingConfig({
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            folders: body.folders,
            autoSendDraft: body.autoSendDraft,
            checkIntervalMinutes: body.checkIntervalMinutes,
            isActive: body.isActive,
        });
        const config = await this.databaseService.getProcessingConfig();
        return { success: true, config };
    }
    async getKeywords() {
        const keywords = await this.databaseService.getDetectionKeywords();
        return { count: keywords.length, keywords };
    }
    async addKeyword(body) {
        await this.databaseService.addDetectionKeyword(body);
        return { success: true };
    }
    async getLogs(limit) {
        const logs = await this.databaseService.getProcessingLogs(limit ? parseInt(limit, 10) : 100);
        return { count: logs.length, logs };
    }
};
exports.DatabaseController = DatabaseController;
__decorate([
    (0, common_1.Get)('clients'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getAllClients", null);
__decorate([
    (0, common_1.Get)('clients/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getClient", null);
__decorate([
    (0, common_1.Get)('clients/by-email/:email'),
    __param(0, (0, common_1.Param)('email')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getClientByEmail", null);
__decorate([
    (0, common_1.Post)('clients'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "createClient", null);
__decorate([
    (0, common_1.Put)('clients/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "updateClient", null);
__decorate([
    (0, common_1.Get)('rfq-mappings'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getAllRfqMappings", null);
__decorate([
    (0, common_1.Get)('rfq-mappings/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getRfqMapping", null);
__decorate([
    (0, common_1.Get)('rfq-mappings/by-client-rfq/:rfqNumber'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getRfqMappingByClientRfq", null);
__decorate([
    (0, common_1.Get)('rfq-mappings/by-internal-rfq/:rfqNumber'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getRfqMappingByInternalRfq", null);
__decorate([
    (0, common_1.Get)('rfq-mappings/client/:clientId'),
    __param(0, (0, common_1.Param)('clientId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getClientRfqMappings", null);
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Put)('config'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Get)('keywords'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getKeywords", null);
__decorate([
    (0, common_1.Post)('keywords'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "addKeyword", null);
__decorate([
    (0, common_1.Get)('logs'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DatabaseController.prototype, "getLogs", null);
exports.DatabaseController = DatabaseController = __decorate([
    (0, common_1.Controller)('database'),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], DatabaseController);
//# sourceMappingURL=database.controller.js.map