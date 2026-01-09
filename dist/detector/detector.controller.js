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
exports.DetectorController = void 0;
const common_1 = require("@nestjs/common");
const detector_service_1 = require("./detector.service");
let DetectorController = class DetectorController {
    constructor(detectorService) {
        this.detectorService = detectorService;
    }
    async analyzeEmail(body) {
        const mockEmail = {
            id: 'test',
            from: 'test@example.com',
            to: 'me@example.com',
            subject: body.subject,
            date: new Date(),
            body: body.body,
            attachments: (body.attachments || []).map(a => ({
                filename: a.filename,
                contentType: 'application/octet-stream',
                content: Buffer.from(''),
                size: 0,
            })),
        };
        const result = await this.detectorService.analyzeEmail(mockEmail);
        return result;
    }
    async refreshKeywords() {
        await this.detectorService.refreshKeywords();
        return {
            success: true,
            keywordsCount: this.detectorService.getKeywordsCount()
        };
    }
};
exports.DetectorController = DetectorController;
__decorate([
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DetectorController.prototype, "analyzeEmail", null);
__decorate([
    (0, common_1.Get)('refresh-keywords'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DetectorController.prototype, "refreshKeywords", null);
exports.DetectorController = DetectorController = __decorate([
    (0, common_1.Controller)('detector'),
    __metadata("design:paramtypes", [detector_service_1.DetectorService])
], DetectorController);
//# sourceMappingURL=detector.controller.js.map