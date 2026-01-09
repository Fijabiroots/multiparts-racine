import { ExtractedPdfData, PriceRequestItem, EmailAttachment } from '../common/interfaces';
export declare class PdfService {
    private readonly logger;
    extractFromBuffer(buffer: Buffer, filename: string): Promise<ExtractedPdfData>;
    extractFromAttachment(attachment: EmailAttachment): Promise<ExtractedPdfData>;
    extractFromAttachments(attachments: EmailAttachment[]): Promise<ExtractedPdfData[]>;
    private extractPRNumber;
    private extractAdditionalInfo;
    private extractPurchaseRequisitionItems;
    private extractSupplierCodeFromDescription;
    private extractBrandFromDescription;
    private extractBrandFromText;
    extractSupplierInfo(text: string): {
        name?: string;
        recommendedSuppliers?: string[];
        brands?: string[];
    };
    extractItemsFromEmailBody(body: string): PriceRequestItem[];
}
