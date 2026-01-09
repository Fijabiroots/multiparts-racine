import { ConfigService } from '@nestjs/config';
import { WebhookService } from '../webhook/webhook.service';
import { SupplierQuote } from './rfq-lifecycle.service';
import { ShippingRecommendation } from './logistics.interface';
export interface ComparisonTable {
    rfqNumber: string;
    clientRfqNumber?: string;
    rfqSubject?: string;
    generatedAt: Date;
    lastUpdatedAt: Date;
    items: ComparisonItem[];
    suppliers: SupplierSummary[];
    recommendation?: string;
    shippingRecommendation?: string;
    filePath: string;
    version: number;
}
export interface ComparisonItem {
    lineNumber: number;
    description: string;
    partNumber?: string;
    requestedQty: number;
    unit?: string;
    supplierPrices: SupplierPrice[];
    lowestPrice?: number;
    lowestPriceSupplier?: string;
}
export interface SupplierPrice {
    supplierEmail: string;
    supplierName?: string;
    unitPrice?: number;
    totalPrice?: number;
    currency?: string;
    deliveryTime?: string;
    availability?: string;
    notes?: string;
}
export interface SupplierSummary {
    email: string;
    name?: string;
    totalAmount?: number;
    currency?: string;
    deliveryTime?: string;
    paymentTerms?: string;
    validity?: string;
    itemsQuoted: number;
    responseDate: Date;
    totalWeightKg?: number;
    incoterm?: string;
    shippingMode?: string;
    hsCode?: string;
    countryOfOrigin?: string;
    shippingRecommendation?: ShippingRecommendation;
}
export declare class QuoteComparisonService {
    private configService;
    private webhookService;
    private readonly logger;
    private readonly outputDir;
    private readonly comparisonsDir;
    private comparisonCache;
    constructor(configService: ConfigService, webhookService: WebhookService);
    private loadExistingComparisons;
    private generateFileName;
    private getComparisonFilePath;
    hasComparison(rfqNumber: string): boolean;
    getExistingComparison(rfqNumber: string): ComparisonTable | undefined;
    private extractLogistics;
    parseExcelQuote(buffer: Buffer, supplierEmail: string, rfqNumber: string): Promise<SupplierQuote>;
    parsePdfQuote(buffer: Buffer, supplierEmail: string, rfqNumber: string): Promise<SupplierQuote>;
    parseEmailBodyQuote(body: string, supplierEmail: string, rfqNumber: string): SupplierQuote;
    addOrUpdateQuote(rfqNumber: string, quote: SupplierQuote, rfqSubject?: string, clientRfqNumber?: string, originalItems?: {
        description: string;
        quantity: number;
        unit?: string;
    }[]): Promise<ComparisonTable>;
    private loadComparisonFromFile;
    private buildComparisonItems;
    private calculateRecommendation;
    private calculateShippingRecommendation;
    private saveComparisonToFile;
    generateComparisonTable(rfqNumber: string, quotes: SupplierQuote[], originalItems?: {
        description: string;
        quantity: number;
        unit?: string;
    }[], rfqSubject?: string, clientRfqNumber?: string): Promise<ComparisonTable>;
    private parseNumber;
    private extractCurrency;
    private extractDeliveryTime;
    private extractPaymentTerms;
    private extractTotalAmount;
}
