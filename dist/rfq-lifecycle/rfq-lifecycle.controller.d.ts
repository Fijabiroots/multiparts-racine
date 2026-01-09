import { Response } from 'express';
import { RfqLifecycleService } from './rfq-lifecycle.service';
import { QuoteComparisonService } from './quote-comparison.service';
import { ReminderService } from './reminder.service';
import { InboundScannerService } from './inbound-scanner.service';
export declare class RfqLifecycleController {
    private readonly lifecycleService;
    private readonly comparisonService;
    private readonly reminderService;
    private readonly inboundService;
    constructor(lifecycleService: RfqLifecycleService, comparisonService: QuoteComparisonService, reminderService: ReminderService, inboundService: InboundScannerService);
    getSentRfqs(): {
        success: boolean;
        count: number;
        data: {
            supplierCount: number;
            respondedCount: number;
            declinedCount: number;
            internalRfqNumber: string;
            clientRfqNumber?: string;
            subject: string;
            sentAt: Date;
            sentBy: string;
            suppliers: import("./rfq-lifecycle.service").ConsultedSupplier[];
            status: "envoy\u00E9" | "en_attente" | "partiellement_r\u00E9pondu" | "complet" | "cl\u00F4tur\u00E9";
            clientEmail?: string;
            clientName?: string;
            itemCount?: number;
            deadline?: Date;
        }[];
    };
    getRfqDetail(rfqNumber: string): {
        success: boolean;
        error: string;
        data?: undefined;
    } | {
        success: boolean;
        data: {
            quotes: {
                supplierEmail: string;
                supplierName: string | undefined;
                receivedAt: Date;
                totalAmount: number | undefined;
                currency: string | undefined;
                deliveryTime: string | undefined;
                itemCount: number;
                needsManualReview: boolean;
            }[];
            internalRfqNumber: string;
            clientRfqNumber?: string;
            subject: string;
            sentAt: Date;
            sentBy: string;
            suppliers: import("./rfq-lifecycle.service").ConsultedSupplier[];
            status: "envoy\u00E9" | "en_attente" | "partiellement_r\u00E9pondu" | "complet" | "cl\u00F4tur\u00E9";
            clientEmail?: string;
            clientName?: string;
            itemCount?: number;
            deadline?: Date;
        };
        error?: undefined;
    };
    scanSentEmails(): Promise<{
        success: boolean;
        message: string;
        data: import("./rfq-lifecycle.service").SentRfq[];
    }>;
    scanInbox(): Promise<{
        success: boolean;
        message: string;
        data: {
            quotes: number;
            declines: number;
        };
    }>;
    getQuotes(rfqNumber: string): {
        success: boolean;
        count: number;
        data: import("./rfq-lifecycle.service").SupplierQuote[];
    };
    generateComparison(rfqNumber: string): Promise<{
        success: boolean;
        error: string;
        data?: undefined;
    } | {
        success: boolean;
        data: {
            rfqNumber: string;
            itemCount: number;
            supplierCount: number;
            recommendation: string | undefined;
            filePath: string;
        };
        error?: undefined;
    }>;
    downloadComparison(rfqNumber: string, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getReminderStatus(): {
        success: boolean;
        data: {
            pendingReminders: number;
            sentToday: number;
            suppliersWithoutResponse: import("./rfq-lifecycle.service").ConsultedSupplier[];
        };
    };
    processReminders(): Promise<{
        success: boolean;
        data: {
            total: number;
            successful: number;
            failed: number;
            details: import("./reminder.service").ReminderResult[];
        };
    }>;
    sendManualReminder(rfqNumber: string, supplierEmail: string): Promise<{
        success: boolean;
        error: string;
        message?: undefined;
    } | {
        success: boolean;
        message: string;
        error?: undefined;
    }>;
    getAllSuppliers(): {
        success: boolean;
        count: number;
        data: any[];
    };
    getDashboard(): {
        success: boolean;
        data: {
            totalRfqs: number;
            byStatus: {
                envoyé: number;
                en_attente: number;
                partiellement_répondu: number;
                complet: number;
                clôturé: number;
            };
            totalSuppliers: number;
            suppliersWithQuotes: number;
            suppliersDeclined: number;
            suppliersPending: number;
            pendingReminders: number;
            remindersSentToday: number;
        };
    };
}
