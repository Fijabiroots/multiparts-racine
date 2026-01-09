import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { PdfService } from '../pdf/pdf.service';
import { ExcelService } from '../excel/excel.service';
import { DraftService } from '../draft/draft.service';
import { AcknowledgmentService } from '../acknowledgment/acknowledgment.service';
import { TrackingService } from '../tracking/tracking.service';
import { WebhookService } from '../webhook/webhook.service';
import { ParsedEmail, PriceRequest, ExtractedPdfData, GeneratedPriceRequest } from '../common/interfaces';
interface ProcessEmailResult {
    success: boolean;
    email?: ParsedEmail;
    extractedData?: ExtractedPdfData[];
    priceRequest?: PriceRequest;
    generatedExcel?: GeneratedPriceRequest;
    draftSaved?: boolean;
    acknowledgmentSent?: boolean;
    tracked?: boolean;
    error?: string;
}
interface ProcessAllResult {
    processed: number;
    successful: number;
    failed: number;
    results: ProcessEmailResult[];
}
export declare class PriceRequestService {
    private readonly configService;
    private readonly emailService;
    private readonly pdfService;
    private readonly excelService;
    private readonly draftService;
    private readonly acknowledgmentService;
    private readonly trackingService;
    private readonly webhookService;
    private readonly logger;
    private readonly DEFAULT_RECIPIENT;
    private readonly DEFAULT_RESPONSE_HOURS;
    constructor(configService: ConfigService, emailService: EmailService, pdfService: PdfService, excelService: ExcelService, draftService: DraftService, acknowledgmentService: AcknowledgmentService, trackingService: TrackingService, webhookService: WebhookService);
    processEmailById(emailId: string, folder?: string, supplierEmail?: string): Promise<ProcessEmailResult>;
    processEmail(email: ParsedEmail, supplierEmail?: string): Promise<ProcessEmailResult>;
    private extractRfqFromSubject;
    processUnreadEmails(folder?: string): Promise<ProcessAllResult>;
    private buildPriceRequest;
    private extractEmailFromSender;
    private extractNameFromSender;
    private extractCompanyFromEmail;
    private calculateDeadline;
    private sendAcknowledgmentToClient;
    generatePreview(emailId: string, folder?: string): Promise<any>;
}
export {};
