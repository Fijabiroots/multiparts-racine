import { ConfigService } from '@nestjs/config';
export declare enum WebhookEventType {
    RFQ_RECEIVED = "rfq.received",
    RFQ_PROCESSED = "rfq.processed",
    RFQ_PROCESSING_ERROR = "rfq.processing_error",
    ACKNOWLEDGMENT_SENT = "acknowledgment.sent",
    ACKNOWLEDGMENT_FAILED = "acknowledgment.failed",
    RFQ_SENT_TO_SUPPLIER = "rfq.sent_to_supplier",
    SUPPLIER_CONSULTED = "supplier.consulted",
    QUOTE_RECEIVED = "quote.received",
    QUOTE_DECLINED = "quote.declined",
    QUOTE_NEEDS_REVIEW = "quote.needs_review",
    COMPARISON_CREATED = "comparison.created",
    COMPARISON_UPDATED = "comparison.updated",
    COMPARISON_COMPLETE = "comparison.complete",
    REMINDER_SENT = "reminder.sent",
    REMINDER_FAILED = "reminder.failed",
    REMINDER_MAX_REACHED = "reminder.max_reached",
    RFQ_STATUS_CHANGED = "rfq.status_changed",
    DEADLINE_APPROACHING = "deadline.approaching",
    DEADLINE_PASSED = "deadline.passed",
    SYSTEM_ERROR = "system.error",
    DAILY_SUMMARY = "daily.summary"
}
export interface WebhookEvent {
    id: string;
    type: WebhookEventType;
    timestamp: Date;
    data: Record<string, any>;
    metadata?: {
        rfqNumber?: string;
        clientEmail?: string;
        supplierEmail?: string;
        filePath?: string;
    };
}
export interface WebhookEndpoint {
    id: string;
    url: string;
    secret?: string;
    events: WebhookEventType[] | '*';
    enabled: boolean;
    retryCount?: number;
    headers?: Record<string, string>;
}
export interface WebhookDeliveryResult {
    endpointId: string;
    success: boolean;
    statusCode?: number;
    error?: string;
    duration?: number;
}
export declare class WebhookService {
    private configService;
    private readonly logger;
    private endpoints;
    private httpClient;
    private readonly configFilePath;
    private readonly logFilePath;
    constructor(configService: ConfigService);
    private loadEndpoints;
    private saveEndpoints;
    addEndpoint(endpoint: Omit<WebhookEndpoint, 'id'>): string;
    removeEndpoint(id: string): boolean;
    toggleEndpoint(id: string, enabled: boolean): boolean;
    listEndpoints(): WebhookEndpoint[];
    private generateEventId;
    private createSignature;
    emit(type: WebhookEventType, data: Record<string, any>, metadata?: WebhookEvent['metadata']): Promise<WebhookDeliveryResult[]>;
    private sendToEndpoint;
    private logEvent;
    getEventHistory(limit?: number): any[];
    emitRfqReceived(rfqNumber: string, clientEmail: string, subject: string, itemCount: number): Promise<void>;
    emitRfqProcessed(rfqNumber: string, clientRfqNumber: string | undefined, itemCount: number, filePath: string): Promise<void>;
    emitAcknowledgmentSent(rfqNumber: string, recipients: string[]): Promise<void>;
    emitQuoteReceived(rfqNumber: string, supplierEmail: string, supplierName: string | undefined, totalAmount?: number, currency?: string): Promise<void>;
    emitQuoteDeclined(rfqNumber: string, supplierEmail: string): Promise<void>;
    emitComparisonCreated(rfqNumber: string, filePath: string, supplierCount: number): Promise<void>;
    emitComparisonUpdated(rfqNumber: string, filePath: string, supplierCount: number, newSupplier: string): Promise<void>;
    emitComparisonComplete(rfqNumber: string, filePath: string, recommendation: string | undefined): Promise<void>;
    emitReminderSent(rfqNumber: string, supplierEmail: string, reminderCount: number): Promise<void>;
    emitRfqStatusChanged(rfqNumber: string, oldStatus: string, newStatus: string): Promise<void>;
    emitDeadlineApproaching(rfqNumber: string, deadline: Date, hoursRemaining: number): Promise<void>;
    emitDailySummary(stats: Record<string, any>): Promise<void>;
    emitSystemError(error: string, context?: Record<string, any>): Promise<void>;
}
