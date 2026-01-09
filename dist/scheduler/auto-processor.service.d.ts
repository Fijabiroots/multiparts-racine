import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { DetectorService } from '../detector/detector.service';
import { DocumentParserService } from '../parser/document-parser.service';
import { ExcelService } from '../excel/excel.service';
import { DraftService } from '../draft/draft.service';
import { ParsedEmail } from '../common/interfaces';
interface ProcessOptions {
    endDate?: Date;
    folders: string[];
    autoSendDraft: boolean;
}
export interface ProcessResult {
    processed: number;
    successful: number;
    failed: number;
    skipped: number;
    details: Array<{
        emailId: string;
        subject: string;
        status: 'success' | 'failed' | 'skipped' | 'not_price_request';
        internalRfqNumber?: string;
        clientRfqNumber?: string;
        error?: string;
    }>;
}
export declare class AutoProcessorService {
    private readonly databaseService;
    private readonly emailService;
    private readonly detectorService;
    private readonly documentParser;
    private readonly excelService;
    private readonly draftService;
    private readonly logger;
    constructor(databaseService: DatabaseService, emailService: EmailService, detectorService: DetectorService, documentParser: DocumentParserService, excelService: ExcelService, draftService: DraftService);
    processNewEmails(options: ProcessOptions): Promise<ProcessResult>;
    processEmail(email: ParsedEmail, autoSendDraft: boolean): Promise<{
        internalRfqNumber: string;
        clientRfqNumber?: string;
        excelPath: string;
    }>;
    private findOrCreateClient;
    private extractEmail;
    private extractName;
    private generateClientCode;
    private calculateDeadline;
    private extractCompanyFromEmail;
    private generateEmailBodyForProcurement;
    private generateAnonymizedEmailBody;
    private isSupplierQuote;
}
export {};
