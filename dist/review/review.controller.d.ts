import { Response } from 'express';
import { ReviewService } from './review.service';
import { PriceRequestItem, DraftUpdateRequest } from '../common/interfaces';
export declare class ReviewController {
    private readonly reviewService;
    constructor(reviewService: ReviewService);
    getPendingReviews(): Promise<{
        success: boolean;
        count: number;
        drafts: import("../common/interfaces").DraftRecord[];
    }>;
    getStats(): Promise<{
        success: boolean;
        stats: {
            total: number;
            pendingReview: number;
            reviewed: number;
            sent: number;
        };
    }>;
    getDraftForReview(draftId: string): Promise<{
        draft: import("../common/interfaces").DraftRecord;
        items: PriceRequestItem[];
        originalPdfUrl?: string;
        needsManualReview: boolean;
        fieldsToReview: string[];
        success: boolean;
    }>;
    getOriginalPdf(draftId: string, res: Response): Promise<void>;
    updateDraft(draftId: string, updateData: DraftUpdateRequest): Promise<{
        success: boolean;
        message: string;
        draft: import("../common/interfaces").DraftRecord;
    }>;
    updateItems(draftId: string, body: {
        items: PriceRequestItem[];
    }): Promise<{
        success: boolean;
        message: string;
        draft: import("../common/interfaces").DraftRecord;
    }>;
    addItem(draftId: string, item: PriceRequestItem): Promise<{
        success: boolean;
        message: string;
        draft: import("../common/interfaces").DraftRecord;
    }>;
    removeItem(draftId: string, itemId: string): Promise<{
        success: boolean;
        message: string;
        draft: import("../common/interfaces").DraftRecord;
    }>;
    approveDraft(draftId: string, body: {
        reviewNotes?: string;
    }): Promise<{
        success: boolean;
        message: string;
        draft: import("../common/interfaces").DraftRecord;
    }>;
}
