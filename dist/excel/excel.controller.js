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
exports.ExcelController = void 0;
const common_1 = require("@nestjs/common");
const excel_service_1 = require("./excel.service");
const dto_1 = require("../common/dto");
let ExcelController = class ExcelController {
    constructor(excelService) {
        this.excelService = excelService;
    }
    async generatePriceRequest(dto, res) {
        const priceRequest = {
            requestNumber: this.excelService.generateRequestNumber(),
            date: new Date(),
            supplier: dto.supplier,
            supplierEmail: dto.supplierEmail,
            items: dto.items,
            notes: dto.notes,
            deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        };
        const result = await this.excelService.generatePriceRequestExcel(priceRequest);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${priceRequest.requestNumber}.xlsx"`);
        res.send(result.excelBuffer);
    }
    async previewPriceRequest(dto) {
        const priceRequest = {
            requestNumber: this.excelService.generateRequestNumber(),
            date: new Date(),
            supplier: dto.supplier,
            supplierEmail: dto.supplierEmail,
            items: dto.items,
            notes: dto.notes,
            deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        };
        const result = await this.excelService.generatePriceRequestExcel(priceRequest);
        return {
            requestNumber: result.priceRequest.requestNumber,
            excelPath: result.excelPath,
            itemsCount: result.priceRequest.items.length,
            supplier: result.priceRequest.supplier,
        };
    }
};
exports.ExcelController = ExcelController;
__decorate([
    (0, common_1.Post)('generate'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreatePriceRequestDto, Object]),
    __metadata("design:returntype", Promise)
], ExcelController.prototype, "generatePriceRequest", null);
__decorate([
    (0, common_1.Post)('preview'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreatePriceRequestDto]),
    __metadata("design:returntype", Promise)
], ExcelController.prototype, "previewPriceRequest", null);
exports.ExcelController = ExcelController = __decorate([
    (0, common_1.Controller)('excel'),
    __metadata("design:paramtypes", [excel_service_1.ExcelService])
], ExcelController);
//# sourceMappingURL=excel.controller.js.map