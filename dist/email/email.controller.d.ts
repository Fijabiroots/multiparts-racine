import { EmailService } from './email.service';
import { EmailFilterDto } from '../common/dto';
export declare class EmailController {
    private readonly emailService;
    constructor(emailService: EmailService);
    listFolders(): Promise<{
        folders: string[];
    }>;
    fetchEmails(filter: EmailFilterDto): Promise<{
        count: number;
        emails: {
            id: string;
            from: string;
            subject: string;
            date: Date;
            hasAttachments: boolean;
            attachments: {
                filename: string;
                contentType: string;
                size: number;
            }[];
        }[];
    }>;
    getUnreadWithPdf(folder?: string): Promise<{
        count: number;
        emails: {
            id: string;
            from: string;
            subject: string;
            date: Date;
            pdfAttachments: {
                filename: string;
                size: number;
            }[];
        }[];
    }>;
    fetchEmailById(id: string, folder?: string): Promise<{
        error: string;
        id?: undefined;
        from?: undefined;
        to?: undefined;
        subject?: undefined;
        date?: undefined;
        body?: undefined;
        attachments?: undefined;
    } | {
        id: string;
        from: string;
        to: string | string[];
        subject: string;
        date: Date;
        body: string;
        attachments: {
            filename: string;
            contentType: string;
            size: number;
        }[];
        error?: undefined;
    }>;
}
