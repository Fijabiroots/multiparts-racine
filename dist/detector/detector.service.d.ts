import { DatabaseService } from '../database/database.service';
import { ParsedEmail } from '../common/interfaces';
export interface DetectionResult {
    isPriceRequest: boolean;
    confidence: number;
    matchedKeywords: Array<{
        keyword: string;
        location: 'subject' | 'body';
        weight: number;
    }>;
    hasRelevantAttachments: boolean;
    attachmentTypes: string[];
    reason: string;
}
export declare class DetectorService {
    private readonly databaseService;
    private readonly logger;
    private keywords;
    private readonly CONFIDENCE_THRESHOLD;
    constructor(databaseService: DatabaseService);
    private loadKeywords;
    refreshKeywords(): Promise<void>;
    analyzeEmail(email: ParsedEmail): Promise<DetectionResult>;
    analyzeEmails(emails: ParsedEmail[]): Promise<Array<{
        email: ParsedEmail;
        detection: DetectionResult;
    }>>;
    filterPriceRequestEmails(emails: ParsedEmail[]): Promise<ParsedEmail[]>;
    private getDefaultKeywords;
    setConfidenceThreshold(threshold: number): void;
    getKeywordsCount(): number;
}
