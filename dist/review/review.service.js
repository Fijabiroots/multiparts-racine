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
var ReviewService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs = require("fs");
const path = require("path");
const uuid_1 = require("uuid");
const database_service_1 = require("../database/database.service");
const excel_service_1 = require("../excel/excel.service");
let ReviewService = ReviewService_1 = class ReviewService {
    constructor(configService, databaseService, excelService) {
        this.configService = configService;
        this.databaseService = databaseService;
        this.excelService = excelService;
        this.logger = new common_1.Logger(ReviewService_1.name);
        this.pdfStoragePath = this.configService.get('PDF_STORAGE_PATH') || './storage/pdfs';
        this.ensureStorageDirectory();
    }
    ensureStorageDirectory() {
        if (!fs.existsSync(this.pdfStoragePath)) {
            fs.mkdirSync(this.pdfStoragePath, { recursive: true });
            this.logger.log(`Répertoire de stockage PDF créé: ${this.pdfStoragePath}`);
        }
    }
    async storeOriginalPdf(buffer, filename, draftId) {
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFilename = `${draftId}_${safeFilename}`;
        const filePath = path.join(this.pdfStoragePath, storedFilename);
        try {
            fs.writeFileSync(filePath, buffer);
            this.logger.log(`PDF original stocké: ${filePath}`);
            return filePath;
        }
        catch (error) {
            this.logger.error(`Erreur stockage PDF: ${error.message}`);
            throw error;
        }
    }
    async getDraftsNeedingReview() {
        const allDrafts = await this.databaseService.getAllDrafts();
        return allDrafts.filter(d => d.needsManualReview === true &&
            (d.status === 'created' || d.status === 'pending_review'));
    }
    async getDraftForReview(draftId) {
        const draft = await this.databaseService.getDraftById(draftId);
        if (!draft) {
            throw new common_1.NotFoundException(`Draft ${draftId} non trouvé`);
        }
        let items = [];
        if (draft.itemsJson) {
            try {
                items = JSON.parse(draft.itemsJson);
            }
            catch (e) {
                this.logger.error(`Erreur parsing items JSON: ${e.message}`);
            }
        }
        const fieldsToReview = [];
        items.forEach(item => {
            if (item.isEstimated)
                fieldsToReview.push('quantity');
            if (item.needsManualReview) {
                if (!item.supplierCode)
                    fieldsToReview.push('supplierCode');
                if (!item.brand)
                    fieldsToReview.push('brand');
            }
        });
        let originalPdfUrl;
        if (draft.originalPdfPath && fs.existsSync(draft.originalPdfPath)) {
            originalPdfUrl = `/api/review/pdf/${draftId}`;
        }
        return {
            draft,
            items,
            originalPdfUrl,
            needsManualReview: draft.needsManualReview || false,
            fieldsToReview: [...new Set(fieldsToReview)],
        };
    }
    async updateDraftItems(draftId, updateData) {
        const draft = await this.databaseService.getDraftById(draftId);
        if (!draft) {
            throw new common_1.NotFoundException(`Draft ${draftId} non trouvé`);
        }
        if (updateData.items) {
            for (const item of updateData.items) {
                if (!item.description || item.description.trim().length < 3) {
                    throw new common_1.BadRequestException('Chaque item doit avoir une description');
                }
                if (!item.quantity || item.quantity <= 0) {
                    throw new common_1.BadRequestException('Chaque item doit avoir une quantité positive');
                }
            }
            updateData.items = updateData.items.map((item, idx) => ({
                ...item,
                id: item.id || (0, uuid_1.v4)(),
                needsManualReview: false,
                isEstimated: false,
            }));
        }
        const updatedDraft = await this.databaseService.updateDraft(draftId, {
            itemsJson: updateData.items ? JSON.stringify(updateData.items) : draft.itemsJson,
            reviewNotes: updateData.reviewNotes,
            status: updateData.status || 'reviewed',
            needsManualReview: false,
            reviewedAt: new Date(),
        });
        if (updateData.items && updateData.items.length > 0) {
            await this.regenerateExcel(updatedDraft, updateData.items);
        }
        this.logger.log(`Draft ${draftId} mis à jour après révision`);
        return updatedDraft;
    }
    async regenerateExcel(draft, items) {
        try {
            const priceRequest = {
                requestNumber: draft.internalRfqNumber,
                clientRfqNumber: draft.clientRfqNumber,
                clientName: draft.clientName,
                clientEmail: draft.clientEmail,
                date: draft.createdAt,
                items,
            };
            const result = await this.excelService.generatePriceRequestExcel(priceRequest);
            if (fs.existsSync(draft.excelPath)) {
                fs.unlinkSync(draft.excelPath);
            }
            fs.writeFileSync(draft.excelPath, result.excelBuffer);
            this.logger.log(`Excel régénéré: ${draft.excelPath}`);
        }
        catch (error) {
            this.logger.error(`Erreur régénération Excel: ${error.message}`);
            throw error;
        }
    }
    async getOriginalPdf(draftId) {
        const draft = await this.databaseService.getDraftById(draftId);
        if (!draft || !draft.originalPdfPath) {
            return null;
        }
        if (!fs.existsSync(draft.originalPdfPath)) {
            this.logger.warn(`PDF non trouvé: ${draft.originalPdfPath}`);
            return null;
        }
        return {
            buffer: fs.readFileSync(draft.originalPdfPath),
            filename: draft.originalPdfFilename || 'original.pdf',
        };
    }
    async markAsReviewed(draftId, reviewNotes) {
        return this.updateDraftItems(draftId, {
            status: 'reviewed',
            reviewNotes,
        });
    }
    async addItemToDraft(draftId, item) {
        const reviewData = await this.getDraftForReview(draftId);
        const items = [...reviewData.items, { ...item, id: (0, uuid_1.v4)() }];
        return this.updateDraftItems(draftId, { items });
    }
    async removeItemFromDraft(draftId, itemId) {
        const reviewData = await this.getDraftForReview(draftId);
        const items = reviewData.items.filter(i => i.id !== itemId);
        if (items.length === 0) {
            throw new common_1.BadRequestException('Impossible de supprimer tous les items');
        }
        return this.updateDraftItems(draftId, { items });
    }
    async getReviewStats() {
        const allDrafts = await this.databaseService.getAllDrafts();
        return {
            total: allDrafts.length,
            pendingReview: allDrafts.filter(d => d.needsManualReview && d.status !== 'reviewed').length,
            reviewed: allDrafts.filter(d => d.status === 'reviewed').length,
            sent: allDrafts.filter(d => d.status === 'sent_to_procurement' || d.status === 'sent_to_supplier').length,
        };
    }
};
exports.ReviewService = ReviewService;
exports.ReviewService = ReviewService = ReviewService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        database_service_1.DatabaseService,
        excel_service_1.ExcelService])
], ReviewService);
//# sourceMappingURL=review.service.js.map