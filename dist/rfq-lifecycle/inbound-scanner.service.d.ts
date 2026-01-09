import { ConfigService } from '@nestjs/config';
import { RfqLifecycleService } from './rfq-lifecycle.service';
import { QuoteComparisonService } from './quote-comparison.service';
import { WebhookService } from '../webhook/webhook.service';
import { BrandIntelligenceService } from '../brand-intelligence/brand-intelligence.service';
export declare class InboundScannerService {
    private configService;
    private rfqLifecycleService;
    private quoteComparisonService;
    private webhookService;
    private brandIntelligence;
    private readonly logger;
    private readonly monitoredInboxes;
    private readonly declineKeywords;
    constructor(configService: ConfigService, rfqLifecycleService: RfqLifecycleService, quoteComparisonService: QuoteComparisonService, webhookService: WebhookService, brandIntelligence: BrandIntelligenceService);
    scheduledInboundScan(): Promise<void>;
    scanInboundEmails(): Promise<{
        quotes: number;
        declines: number;
    }>;
    private processInboundEmail;
    private findRfqReference;
    private isDeclineEmail;
    private extractQuoteData;
    private checkAndGenerateComparison;
    private extractEmail;
    private extractName;
    private getImapConfig;
}
