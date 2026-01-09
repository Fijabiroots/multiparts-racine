import { ShippingMode } from '../common/company-info';
export interface LogisticsInfo {
    totalWeightKg?: number;
    volumetricWeightKg?: number;
    dimensions?: {
        lengthCm: number;
        widthCm: number;
        heightCm: number;
    };
    incoterm?: string;
    proposedShippingMode?: ShippingMode | string;
    hsCode?: string;
    countryOfOrigin?: string;
    countryCode?: string;
    departurePort?: string;
    shippingDays?: number;
    logisticsNotes?: string;
}
export interface ShippingRecommendation {
    mode: ShippingMode;
    reason: string;
    alternatives: ShippingMode[];
    estimatedCost?: {
        sea?: number;
        air?: number;
        express?: number;
    };
    estimatedDays?: {
        sea?: number;
        air?: number;
        express?: number;
    };
}
export interface LogisticsSummary {
    supplierEmail: string;
    supplierName?: string;
    totalWeightKg?: number;
    incoterm?: string;
    shippingMode?: string;
    hsCode?: string;
    countryOfOrigin?: string;
    recommendation?: ShippingRecommendation;
}
export declare const LOGISTICS_PATTERNS: {
    weight: RegExp[];
    incoterm: RegExp[];
    shipping: RegExp[];
    hsCode: RegExp[];
    origin: RegExp[];
    dimensions: RegExp[];
};
export declare function extractLogisticsFromText(text: string): LogisticsInfo;
export declare const COUNTRY_CODES: Record<string, string>;
