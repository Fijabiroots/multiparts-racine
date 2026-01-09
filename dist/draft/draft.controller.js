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
exports.DraftController = void 0;
const common_1 = require("@nestjs/common");
const draft_service_1 = require("./draft.service");
const rfq_instructions_1 = require("../common/rfq-instructions");
const company_info_1 = require("../common/company-info");
let DraftController = class DraftController {
    constructor(draftService) {
        this.draftService = draftService;
    }
    async listDrafts(limit) {
        const drafts = await this.draftService.listDrafts(limit ? parseInt(limit, 10) : 10);
        return {
            success: true,
            count: drafts.length,
            data: drafts,
        };
    }
    getRfqInstructions(language) {
        return {
            success: true,
            language: language || 'both',
            html: (0, rfq_instructions_1.getRfqInstructions)(language || 'both'),
            availableLanguages: ['fr', 'en', 'both'],
        };
    }
    previewRfqInstructions(language) {
        const lang = language || 'both';
        const header = (0, company_info_1.getCompanyHeader)();
        const instructions = (0, rfq_instructions_1.getRfqInstructions)(lang);
        const address = (0, company_info_1.getAddressBlock)();
        return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Instructions RFQ - MULTIPARTS</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; }
  </style>
</head>
<body>
  ${header}
  <h2>Instructions RFQ (${lang === 'fr' ? 'Français' : lang === 'en' ? 'English' : 'Bilingue'})</h2>
  ${instructions}
  <h3>Adresse de livraison</h3>
  ${address}
</body>
</html>`;
    }
    getCompanyInfo() {
        return {
            success: true,
            data: company_info_1.COMPANY_INFO,
            templates: {
                header: (0, company_info_1.getCompanyHeader)(),
                addressBlock: (0, company_info_1.getAddressBlock)(),
            },
        };
    }
    getAvailableLanguages() {
        return {
            success: true,
            data: [
                { code: 'fr', name: 'Français', description: 'Instructions en français uniquement' },
                { code: 'en', name: 'English', description: 'Instructions in English only' },
                { code: 'both', name: 'Bilingue', description: 'Instructions in both French and English' },
            ],
            default: 'both',
            autoDetection: {
                enabled: true,
                description: 'La langue peut être détectée automatiquement basée sur le domaine email du destinataire',
                frenchDomains: ['.fr', '.be', '.ch', '.ca', '.lu', '.ci', '.sn', '.ml'],
                englishDomains: ['.uk', '.us', '.au', '.nz', '.ie', '.za', '.ng'],
            },
        };
    }
    async createTestDraft(body) {
        const to = body.to || 'test@example.com';
        const language = body.language || 'both';
        const result = await this.draftService.saveToDrafts({
            to,
            subject: `[TEST] Instructions RFQ - MULTIPARTS (${language})`,
            body: 'Ceci est un email de test.',
            htmlBody: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
${(0, company_info_1.getCompanyHeader)()}
<p>Ceci est un email de test pour prévisualiser les instructions RFQ.</p>
${(0, rfq_instructions_1.getRfqInstructions)(language)}
${(0, company_info_1.getAddressBlock)()}
</body>
</html>
`,
        });
        return {
            success: result.success,
            message: result.success
                ? `Brouillon de test créé avec succès (langue: ${language})`
                : `Erreur: ${result.error}`,
            to,
            language,
        };
    }
};
exports.DraftController = DraftController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DraftController.prototype, "listDrafts", null);
__decorate([
    (0, common_1.Get)('rfq-instructions'),
    __param(0, (0, common_1.Query)('language')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DraftController.prototype, "getRfqInstructions", null);
__decorate([
    (0, common_1.Get)('rfq-instructions/preview'),
    __param(0, (0, common_1.Query)('language')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DraftController.prototype, "previewRfqInstructions", null);
__decorate([
    (0, common_1.Get)('company-info'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DraftController.prototype, "getCompanyInfo", null);
__decorate([
    (0, common_1.Get)('languages'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DraftController.prototype, "getAvailableLanguages", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DraftController.prototype, "createTestDraft", null);
exports.DraftController = DraftController = __decorate([
    (0, common_1.Controller)('drafts'),
    __metadata("design:paramtypes", [draft_service_1.DraftService])
], DraftController);
//# sourceMappingURL=draft.controller.js.map