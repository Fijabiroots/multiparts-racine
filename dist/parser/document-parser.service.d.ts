import { EmailAttachment, PriceRequestItem } from '../common/interfaces';
export interface ExtractedDocumentData {
    filename: string;
    type: 'pdf' | 'excel' | 'word' | 'email' | 'image';
    text: string;
    items: PriceRequestItem[];
    tables?: any[][];
    rfqNumber?: string;
    needsVerification?: boolean;
    extractionMethod?: string;
    deadline?: string;
    contactName?: string;
    contactPhone?: string;
    contactRole?: string;
    isUrgent?: boolean;
}
export declare class DocumentParserService {
    private readonly logger;
    private readonly rfqPatterns;
    parseDocument(attachment: EmailAttachment): Promise<ExtractedDocumentData | null>;
    parseAllAttachments(attachments: EmailAttachment[]): Promise<ExtractedDocumentData[]>;
    parseEmailBody(body: string, subject: string): ExtractedDocumentData;
    private extractItemsFromEmailBody;
    private extractEmailMetadata;
    private parsePdf;
    private extractTextWithPdftotext;
    private extractTextWithOcr;
    private extractInfoFromFilename;
    private parseExcel;
    private extractItemsFromExcelSheet;
    private parseWord;
    private parseImage;
    private extractNameplateInfo;
    extractItemsFromText(text: string): PriceRequestItem[];
    private extractPurchaseRequisitionItems;
    private extractAdditionalDescription;
    private finalizeMultilineItem;
    private cleanPRDescription;
    private extractSupplierCodeFromDesc;
    private extractBrandFromDesc;
    private parseMatchedItem;
    private parseQuantity;
    extractRfqNumber(text: string): string | undefined;
    extractSupplierInfo(text: string): {
        name?: string;
        email?: string;
        phone?: string;
    };
}
