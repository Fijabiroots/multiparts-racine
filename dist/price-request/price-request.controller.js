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
exports.PriceRequestController = void 0;
const common_1 = require("@nestjs/common");
const price_request_service_1 = require("./price-request.service");
const dto_1 = require("../common/dto");
let PriceRequestController = class PriceRequestController {
    constructor(priceRequestService) {
        this.priceRequestService = priceRequestService;
    }
    async processEmail(dto, folder) {
        const result = await this.priceRequestService.processEmailById(dto.emailId, folder || 'INBOX', dto.supplierEmail);
        return {
            success: result.success,
            error: result.error,
            email: result.email
                ? {
                    id: result.email.id,
                    from: result.email.from,
                    subject: result.email.subject,
                }
                : undefined,
            priceRequest: result.priceRequest
                ? {
                    requestNumber: result.priceRequest.requestNumber,
                    itemsCount: result.priceRequest.items.length,
                    supplier: result.priceRequest.supplier,
                    deadline: result.priceRequest.deadline,
                }
                : undefined,
            excelPath: result.generatedExcel?.excelPath,
            draftSaved: result.draftSaved,
        };
    }
    async processAllUnread(folder) {
        const result = await this.priceRequestService.processUnreadEmails(folder || 'INBOX');
        return {
            summary: {
                processed: result.processed,
                successful: result.successful,
                failed: result.failed,
            },
            results: result.results.map((r) => ({
                success: r.success,
                error: r.error,
                emailId: r.email?.id,
                emailSubject: r.email?.subject,
                requestNumber: r.priceRequest?.requestNumber,
                draftSaved: r.draftSaved,
            })),
        };
    }
    async getPreview(emailId, folder) {
        return this.priceRequestService.generatePreview(emailId, folder || 'INBOX');
    }
};
exports.PriceRequestController = PriceRequestController;
__decorate([
    (0, common_1.Post)('process'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Query)('folder')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ProcessEmailDto, String]),
    __metadata("design:returntype", Promise)
], PriceRequestController.prototype, "processEmail", null);
__decorate([
    (0, common_1.Post)('process-all'),
    __param(0, (0, common_1.Query)('folder')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PriceRequestController.prototype, "processAllUnread", null);
__decorate([
    (0, common_1.Get)('preview/:emailId'),
    __param(0, (0, common_1.Param)('emailId')),
    __param(1, (0, common_1.Query)('folder')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PriceRequestController.prototype, "getPreview", null);
exports.PriceRequestController = PriceRequestController = __decorate([
    (0, common_1.Controller)('price-request'),
    __metadata("design:paramtypes", [price_request_service_1.PriceRequestService])
], PriceRequestController);
//# sourceMappingURL=price-request.controller.js.map