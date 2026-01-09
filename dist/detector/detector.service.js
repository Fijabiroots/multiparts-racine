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
var DetectorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DetectorService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
let DetectorService = DetectorService_1 = class DetectorService {
    constructor(databaseService) {
        this.databaseService = databaseService;
        this.logger = new common_1.Logger(DetectorService_1.name);
        this.keywords = [];
        this.CONFIDENCE_THRESHOLD = 30;
        this.loadKeywords();
    }
    async loadKeywords() {
        try {
            this.keywords = await this.databaseService.getDetectionKeywords();
            this.logger.log(`${this.keywords.length} mots-clés de détection chargés`);
        }
        catch (error) {
            this.logger.error('Erreur chargement mots-clés:', error.message);
            this.keywords = this.getDefaultKeywords();
        }
    }
    async refreshKeywords() {
        await this.loadKeywords();
    }
    async analyzeEmail(email) {
        if (this.keywords.length === 0) {
            await this.loadKeywords();
        }
        const matchedKeywords = [];
        let totalScore = 0;
        const subjectLower = email.subject.toLowerCase();
        const bodyLower = email.body.toLowerCase();
        for (const kw of this.keywords) {
            const keywordLower = kw.keyword.toLowerCase();
            if ((kw.type === 'subject' || kw.type === 'both') && subjectLower.includes(keywordLower)) {
                matchedKeywords.push({ keyword: kw.keyword, location: 'subject', weight: kw.weight });
                totalScore += kw.weight * 1.5;
            }
            if ((kw.type === 'body' || kw.type === 'both') && bodyLower.includes(keywordLower)) {
                matchedKeywords.push({ keyword: kw.keyword, location: 'body', weight: kw.weight });
                totalScore += kw.weight;
            }
        }
        const relevantExtensions = ['.pdf', '.xlsx', '.xls', '.docx', '.doc'];
        const attachmentTypes = email.attachments
            .map(att => {
            const ext = att.filename.substring(att.filename.lastIndexOf('.')).toLowerCase();
            return ext;
        })
            .filter(ext => relevantExtensions.includes(ext));
        const hasRelevantAttachments = attachmentTypes.length > 0;
        if (hasRelevantAttachments) {
            totalScore += 10;
        }
        const maxPossibleScore = this.keywords.reduce((sum, kw) => sum + kw.weight * 2.5, 0) + 10;
        const confidence = Math.min(100, Math.round((totalScore / maxPossibleScore) * 100 * 2));
        const isPriceRequest = confidence >= this.CONFIDENCE_THRESHOLD;
        let reason = '';
        if (isPriceRequest) {
            reason = `Détecté comme demande de prix (confiance: ${confidence}%). `;
            reason += `Mots-clés trouvés: ${matchedKeywords.map(m => m.keyword).join(', ')}.`;
            if (hasRelevantAttachments) {
                reason += ` Pièces jointes: ${attachmentTypes.join(', ')}.`;
            }
        }
        else {
            reason = `Non identifié comme demande de prix (confiance: ${confidence}%). `;
            if (matchedKeywords.length === 0) {
                reason += 'Aucun mot-clé de demande de prix trouvé.';
            }
            else {
                reason += `Score insuffisant malgré ${matchedKeywords.length} mot(s)-clé(s) trouvé(s).`;
            }
        }
        return {
            isPriceRequest,
            confidence,
            matchedKeywords,
            hasRelevantAttachments,
            attachmentTypes,
            reason,
        };
    }
    async analyzeEmails(emails) {
        const results = [];
        for (const email of emails) {
            const detection = await this.analyzeEmail(email);
            results.push({ email, detection });
        }
        return results;
    }
    async filterPriceRequestEmails(emails) {
        const analyzed = await this.analyzeEmails(emails);
        return analyzed
            .filter(item => item.detection.isPriceRequest)
            .map(item => item.email);
    }
    getDefaultKeywords() {
        return [
            { id: '1', keyword: 'demande de prix', weight: 10, language: 'fr', type: 'both' },
            { id: '2', keyword: 'demande de cotation', weight: 10, language: 'fr', type: 'both' },
            { id: '3', keyword: 'RFQ', weight: 10, language: 'both', type: 'both' },
            { id: '4', keyword: 'devis', weight: 8, language: 'fr', type: 'both' },
            { id: '5', keyword: 'cotation', weight: 8, language: 'fr', type: 'both' },
            { id: '6', keyword: 'offre de prix', weight: 9, language: 'fr', type: 'both' },
            { id: '7', keyword: 'request for quotation', weight: 10, language: 'en', type: 'both' },
            { id: '8', keyword: 'price request', weight: 9, language: 'en', type: 'both' },
            { id: '9', keyword: 'quote request', weight: 8, language: 'en', type: 'both' },
        ];
    }
    setConfidenceThreshold(threshold) {
        this.CONFIDENCE_THRESHOLD = threshold;
    }
    getKeywordsCount() {
        return this.keywords.length;
    }
};
exports.DetectorService = DetectorService;
exports.DetectorService = DetectorService = DetectorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], DetectorService);
//# sourceMappingURL=detector.service.js.map