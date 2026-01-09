import { ConfigService } from '@nestjs/config';
export interface EmailRecipients {
    from: string;
    to: string[];
    cc?: string[];
    replyTo?: string;
}
export interface AcknowledgmentData {
    rfqNumber?: string;
    subject: string;
    itemCount: number;
    deadline?: string;
    senderName?: string;
    isUrgent?: boolean;
    originalMessageId?: string;
    originalReferences?: string;
}
export declare class AcknowledgmentService {
    private configService;
    private readonly logger;
    private transporter;
    private signature;
    constructor(configService: ConfigService);
    private initializeTransporter;
    private loadThunderbirdSignature;
    private loadDefaultSignature;
    setSignature(signature: string): void;
    loadSignatureFromFile(filePath: string): boolean;
    hasAcknowledgmentBeenSent(originalMessageId: string, originalSubject: string): Promise<boolean>;
    sendAcknowledgment(recipients: EmailRecipients, data: AcknowledgmentData): Promise<boolean>;
    private generateAcknowledgmentContent;
    private cleanEmailAddress;
    private isOurEmail;
    private extractFirstName;
    private capitalizeFirst;
    private stripHtml;
}
