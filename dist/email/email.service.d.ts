import { ConfigService } from '@nestjs/config';
import * as imapSimple from 'imap-simple';
import { ParsedEmail } from '../common/interfaces';
import { EmailFilterDto } from '../common/dto';
export declare class EmailService {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService);
    private getImapConfig;
    connect(): Promise<imapSimple.ImapSimple>;
    listFolders(): Promise<string[]>;
    private extractFolderNames;
    fetchEmails(filter: EmailFilterDto): Promise<ParsedEmail[]>;
    fetchEmailById(emailId: string, folder?: string): Promise<ParsedEmail | null>;
    private parseMessage;
    getUnreadEmailsWithPdfAttachments(folder?: string): Promise<ParsedEmail[]>;
}
