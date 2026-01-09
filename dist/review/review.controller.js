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
exports.ReviewController = void 0;
const common_1 = require("@nestjs/common");
const review_service_1 = require("./review.service");
let ReviewController = class ReviewController {
    constructor(reviewService) {
        this.reviewService = reviewService;
    }
    async getPendingReviews() {
        const drafts = await this.reviewService.getDraftsNeedingReview();
        return {
            success: true,
            count: drafts.length,
            drafts,
        };
    }
    async getStats() {
        const stats = await this.reviewService.getReviewStats();
        return {
            success: true,
            stats,
        };
    }
    async getDraftForReview(draftId) {
        try {
            const reviewData = await this.reviewService.getDraftForReview(draftId);
            return {
                success: true,
                ...reviewData,
            };
        }
        catch (error) {
            if (error instanceof common_1.NotFoundException) {
                throw error;
            }
            throw new common_1.BadRequestException(error.message);
        }
    }
    async getOriginalPdf(draftId, res) {
        const pdf = await this.reviewService.getOriginalPdf(draftId);
        if (!pdf) {
            throw new common_1.NotFoundException('PDF original non trouvé');
        }
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${pdf.filename}"`,
            'Content-Length': pdf.buffer.length,
        });
        res.send(pdf.buffer);
    }
    async updateDraft(draftId, updateData) {
        try {
            const draft = await this.reviewService.updateDraftItems(draftId, updateData);
            return {
                success: true,
                message: 'Draft mis à jour avec succès',
                draft,
            };
        }
        catch (error) {
            if (error instanceof common_1.NotFoundException || error instanceof common_1.BadRequestException) {
                throw error;
            }
            throw new common_1.BadRequestException(error.message);
        }
    }
    async updateItems(draftId, body) {
        if (!body.items || !Array.isArray(body.items)) {
            throw new common_1.BadRequestException('Items invalides');
        }
        const draft = await this.reviewService.updateDraftItems(draftId, { items: body.items });
        return {
            success: true,
            message: `${body.items.length} items mis à jour`,
            draft,
        };
    }
    async addItem(draftId, item) {
        if (!item.description) {
            throw new common_1.BadRequestException('Description requise');
        }
        const draft = await this.reviewService.addItemToDraft(draftId, {
            ...item,
            quantity: item.quantity || 1,
            unit: item.unit || 'pcs',
        });
        return {
            success: true,
            message: 'Item ajouté',
            draft,
        };
    }
    async removeItem(draftId, itemId) {
        const draft = await this.reviewService.removeItemFromDraft(draftId, itemId);
        return {
            success: true,
            message: 'Item supprimé',
            draft,
        };
    }
    async approveDraft(draftId, body) {
        const draft = await this.reviewService.markAsReviewed(draftId, body.reviewNotes);
        return {
            success: true,
            message: 'Draft approuvé et prêt à envoyer',
            draft,
        };
    }
};
exports.ReviewController = ReviewController;
__decorate([
    (0, common_1.Get)('pending'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "getPendingReviews", null);
__decorate([
    (0, common_1.Get)('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':draftId'),
    __param(0, (0, common_1.Param)('draftId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "getDraftForReview", null);
__decorate([
    (0, common_1.Get)('pdf/:draftId'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "getOriginalPdf", null);
__decorate([
    (0, common_1.Put)(':draftId'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "updateDraft", null);
__decorate([
    (0, common_1.Put)(':draftId/items'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "updateItems", null);
__decorate([
    (0, common_1.Post)(':draftId/items'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "addItem", null);
__decorate([
    (0, common_1.Delete)(':draftId/items/:itemId'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "removeItem", null);
__decorate([
    (0, common_1.Post)(':draftId/approve'),
    __param(0, (0, common_1.Param)('draftId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReviewController.prototype, "approveDraft", null);
exports.ReviewController = ReviewController = __decorate([
    (0, common_1.Controller)('api/review'),
    __metadata("design:paramtypes", [review_service_1.ReviewService])
], ReviewController);
//# sourceMappingURL=review.controller.js.map