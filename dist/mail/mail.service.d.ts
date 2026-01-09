import { ConfigService } from '@nestjs/config';
interface SendMailOptions {
    to: string;
    subject: string;
    body: string;
    htmlBody?: string;
    attachments?: Array<{
        filename: string;
        path?: string;
        content?: Buffer;
        contentType?: string;
    }>;
}
interface SendMailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}
export declare class MailService {
    private configService;
    private readonly logger;
    private transporter;
    constructor(configService: ConfigService);
    private initTransporter;
    private getImapConfig;
    sendMail(options: SendMailOptions): Promise<SendMailResult>;
    private copyToSentFolder;
    private createMimeMessageFromOptions;
    sendPriceRequestEmail(draft: {
        recipient: string;
        subject: string;
        internalRfqNumber: string;
        clientRfqNumber?: string;
        clientName?: string;
        clientEmail?: string;
        excelPath: string;
        attachmentPaths?: string[];
        responseDeadlineHours?: number;
    }): Promise<SendMailResult>;
    private generateEmailBody;
    private textToHtml;
    verifyConnection(): Promise<boolean>;
}
export {};
