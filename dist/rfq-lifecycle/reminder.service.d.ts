import { ConfigService } from '@nestjs/config';
import { RfqLifecycleService, ConsultedSupplier, SentRfq } from './rfq-lifecycle.service';
import { WebhookService } from '../webhook/webhook.service';
export interface ReminderConfig {
    enabled: boolean;
    maxReminders: number;
    daysBetweenReminders: number;
    reminderTimes: string[];
}
export interface ReminderResult {
    supplierEmail: string;
    rfqNumber: string;
    success: boolean;
    reminderCount: number;
    error?: string;
}
export declare class ReminderService {
    private configService;
    private rfqLifecycleService;
    private webhookService;
    private readonly logger;
    private transporter;
    private signature;
    constructor(configService: ConfigService, rfqLifecycleService: RfqLifecycleService, webhookService: WebhookService);
    private initializeTransporter;
    private loadSignature;
    scheduledReminderCheck(): Promise<void>;
    processReminders(): Promise<ReminderResult[]>;
    sendReminder(supplier: ConsultedSupplier, rfq: SentRfq): Promise<boolean>;
    private generateReminderContent;
    sendManualReminder(rfqNumber: string, supplierEmail: string): Promise<boolean>;
    getReminderStatus(): {
        pendingReminders: number;
        sentToday: number;
        suppliersWithoutResponse: ConsultedSupplier[];
    };
}
