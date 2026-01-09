import { ConfigService } from '@nestjs/config';
import { LogisticsInfo } from './logistics.interface';
export interface ConsultedSupplier {
    email: string;
    name?: string;
    consultedAt: Date;
    rfqNumber: string;
    status: 'consulté' | 'offre_reçue' | 'refus' | 'relancé' | 'sans_réponse';
    lastReminderAt?: Date;
    reminderCount: number;
    responseAt?: Date;
    quoteReference?: string;
}
export interface SentRfq {
    internalRfqNumber: string;
    clientRfqNumber?: string;
    subject: string;
    sentAt: Date;
    sentBy: string;
    suppliers: ConsultedSupplier[];
    status: 'envoyé' | 'en_attente' | 'partiellement_répondu' | 'complet' | 'clôturé';
    clientEmail?: string;
    clientName?: string;
    itemCount?: number;
    deadline?: Date;
}
export interface SupplierQuote {
    supplierEmail: string;
    supplierName?: string;
    rfqNumber: string;
    receivedAt: Date;
    subject: string;
    currency?: string;
    totalAmount?: number;
    deliveryTime?: string;
    paymentTerms?: string;
    validity?: string;
    items: QuoteItem[];
    attachments: string[];
    rawText?: string;
    needsManualReview: boolean;
    logistics?: LogisticsInfo;
}
export interface QuoteItem {
    description: string;
    partNumber?: string;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    totalPrice?: number;
    currency?: string;
    deliveryTime?: string;
    notes?: string;
    weightKg?: number;
    hsCode?: string;
    countryOfOrigin?: string;
}
export declare class RfqLifecycleService {
    private configService;
    private readonly logger;
    private readonly dataFilePath;
    private sentRfqs;
    private supplierQuotes;
    private readonly monitoredEmails;
    constructor(configService: ConfigService);
    private loadData;
    private saveData;
    scanSentEmails(): Promise<SentRfq[]>;
    private processOutboundEmail;
    private isRfqEmail;
    private extractRfqNumber;
    private extractClientRfqNumber;
    private extractSupplierEmails;
    private countItems;
    private getImapConfig;
    getSentRfqs(): SentRfq[];
    getRfqByNumber(rfqNumber: string): SentRfq | undefined;
    getSuppliersNeedingReminder(maxReminderCount?: number, minDaysSinceLastContact?: number): ConsultedSupplier[];
    markSupplierReminded(rfqNumber: string, supplierEmail: string): void;
    registerSupplierQuote(quote: SupplierQuote): void;
    registerSupplierDecline(rfqNumber: string, supplierEmail: string): void;
    getQuotesForRfq(rfqNumber: string): SupplierQuote[];
}
