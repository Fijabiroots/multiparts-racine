import { ConfigService } from '@nestjs/config';
import { GeneratedPriceRequest } from '../common/interfaces';
import { RfqLanguage } from '../common/rfq-instructions';
import { BrandIntelligenceService } from '../brand-intelligence/brand-intelligence.service';
import { BrandAnalysisResult } from '../brand-intelligence/brand.interface';
interface DraftEmailOptions {
    to: string;
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    htmlBody?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
    }>;
}
export interface PriceRequestDraftOptions {
    recipientEmail?: string;
    cc?: string[];
    bcc?: string[];
    language?: RfqLanguage;
    autoDetectLanguage?: boolean;
    autoAddSuppliers?: boolean;
    additionalAttachments?: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
    }>;
}
export interface DraftResult {
    success: boolean;
    messageId?: string;
    error?: string;
    brandAnalysis?: BrandAnalysisResult;
    bccSuppliers?: string[];
}
export declare class DraftService {
    private configService;
    private brandIntelligence;
    private readonly logger;
    constructor(configService: ConfigService, brandIntelligence: BrandIntelligenceService);
    private getImapConfig;
    saveToDrafts(options: DraftEmailOptions): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    private createMimeMessage;
    private textToHtml;
    savePriceRequestDraft(generated: GeneratedPriceRequest, options?: PriceRequestDraftOptions): Promise<DraftResult>;
    private generateHtmlEmailBody;
    private generateTextEmailBody;
    listDrafts(limit?: number): Promise<any[]>;
}
export {};
