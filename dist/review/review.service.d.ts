import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { ExcelService } from '../excel/excel.service';
import { DraftRecord, PriceRequestItem, DraftUpdateRequest, DraftReviewResponse } from '../common/interfaces';
export declare class ReviewService {
    private configService;
    private databaseService;
    private excelService;
    private readonly logger;
    private readonly pdfStoragePath;
    constructor(configService: ConfigService, databaseService: DatabaseService, excelService: ExcelService);
    private ensureStorageDirectory;
    storeOriginalPdf(buffer: Buffer, filename: string, draftId: string): Promise<string>;
    getDraftsNeedingReview(): Promise<DraftRecord[]>;
    getDraftForReview(draftId: string): Promise<DraftReviewResponse>;
    updateDraftItems(draftId: string, updateData: DraftUpdateRequest): Promise<DraftRecord>;
    private regenerateExcel;
    getOriginalPdf(draftId: string): Promise<{
        buffer: Buffer;
        filename: string;
    } | null>;
    markAsReviewed(draftId: string, reviewNotes?: string): Promise<DraftRecord>;
    addItemToDraft(draftId: string, item: PriceRequestItem): Promise<DraftRecord>;
    removeItemFromDraft(draftId: string, itemId: string): Promise<DraftRecord>;
    getReviewStats(): Promise<{
        total: number;
        pendingReview: number;
        reviewed: number;
        sent: number;
    }>;
}
