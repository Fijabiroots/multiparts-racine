export interface EmailAttachment {
    filename: string;
    contentType: string;
    content: Buffer;
    size: number;
}
export interface ParsedEmail {
    id: string;
    messageId?: string;
    from: string;
    to: string | string[];
    cc?: string[];
    replyTo?: string;
    references?: string;
    subject: string;
    date: Date;
    body: string;
    attachments: EmailAttachment[];
}
export interface ExtractedPdfData {
    filename: string;
    text: string;
    pages?: number;
    items: PriceRequestItem[];
    rfqNumber?: string;
    generalDescription?: string;
    additionalDescription?: string;
    fleetNumber?: string;
    serialNumber?: string;
    recommendedSuppliers?: string[];
    supplierInfo?: {
        name?: string;
        email?: string;
    };
    needsVerification?: boolean;
    extractionMethod?: string;
}
export interface PriceRequestItem {
    id?: string;
    reference?: string;
    internalCode?: string;
    supplierCode?: string;
    brand?: string;
    description: string;
    quantity: number;
    unit?: string;
    notes?: string;
    serialNumber?: string;
    needsManualReview?: boolean;
    isEstimated?: boolean;
    originalLine?: number;
}
export interface PriceRequest {
    requestNumber: string;
    clientRfqNumber?: string;
    clientName?: string;
    clientEmail?: string;
    date: Date;
    supplier?: string;
    supplierEmail?: string;
    items: PriceRequestItem[];
    notes?: string;
    deadline?: Date;
    responseDeadlineHours?: number;
    sourceEmail?: ParsedEmail;
    additionalAttachments?: EmailAttachment[];
    fleetNumber?: string;
    serialNumber?: string;
    needsManualReview?: boolean;
    extractionMethod?: string;
}
export interface GeneratedPriceRequest {
    priceRequest: PriceRequest;
    excelPath: string;
    excelBuffer: Buffer;
}
export type AttachmentType = 'rfq_pdf' | 'image' | 'document' | 'other';
export declare function getAttachmentType(contentType: string, filename: string): AttachmentType;
export type DraftStatus = 'created' | 'pending_review' | 'reviewed' | 'sent_to_procurement' | 'sent_to_supplier' | 'completed';
export interface DraftRecord {
    id: string;
    internalRfqNumber: string;
    clientRfqNumber?: string;
    clientName?: string;
    clientEmail?: string;
    excelPath: string;
    status: DraftStatus;
    createdAt: Date;
    updatedAt: Date;
    sentAt?: Date;
    sentTo?: string;
    originalPdfPath?: string;
    originalPdfFilename?: string;
    needsManualReview?: boolean;
    extractionMethod?: string;
    reviewNotes?: string;
    reviewedAt?: Date;
    reviewedBy?: string;
    itemsJson?: string;
}
export interface DraftUpdateRequest {
    items?: PriceRequestItem[];
    reviewNotes?: string;
    status?: DraftStatus;
}
export interface DraftReviewResponse {
    draft: DraftRecord;
    items: PriceRequestItem[];
    originalPdfUrl?: string;
    needsManualReview: boolean;
    fieldsToReview: string[];
}
export interface AppConfig {
    defaultRecipient: string;
    responseDeadlineHours: number;
    checkIntervalMinutes: number;
    autoSendToProcurement: boolean;
    readEndDate?: Date;
    requireManualReviewForOcr: boolean;
}
