import { PdfService } from './pdf.service';
export declare class PdfController {
    private readonly pdfService;
    constructor(pdfService: PdfService);
    extractFromPdf(file: Express.Multer.File): Promise<{
        filename: string;
        pages: number | undefined;
        itemsFound: number;
        items: import("../common").PriceRequestItem[];
        supplierInfo: {
            name?: string;
            recommendedSuppliers?: string[];
            brands?: string[];
        };
        textPreview: string;
    }>;
}
