export interface BrandCategory {
    key: string;
    label: string;
    examples?: string[];
    keywords?: string[];
}
export interface Brand {
    name: string;
    normalizedName: string;
    category: string;
    aliases?: string[];
    createdAt: Date;
    updatedAt: Date;
    source: 'initial' | 'auto_detected' | 'manual';
}
export interface SupplierBrandRelation {
    supplierEmail: string;
    supplierName?: string;
    brandName: string;
    quotesCount: number;
    successfulQuotes: number;
    declinedCount: number;
    averageResponseDays?: number;
    lastQuoteAt?: Date;
    lastDeclineAt?: Date;
    reliability: number;
    isPreferred: boolean;
    firstContactAt: Date;
    updatedAt: Date;
    notes?: string;
}
export interface SupplierSuggestion {
    email: string;
    name?: string;
    brand: string;
    category: string;
    reliability: number;
    quotesCount: number;
    lastActivity?: Date;
    isPreferred: boolean;
    reason: string;
}
export interface AutoSendConfig {
    enabled: boolean;
    minReliability: number;
    maxSuppliersPerBrand: number;
    excludeDeclined: boolean;
    declineCooldownDays: number;
}
export interface BrandAnalysisResult {
    detectedBrands: string[];
    newBrands: string[];
    suggestedSuppliers: SupplierSuggestion[];
    autoSendEmails: string[];
    manualReviewEmails: string[];
}
export interface BrandDatabase {
    version: string;
    lastUpdated: Date;
    categories: BrandCategory[];
    brands: Brand[];
    supplierRelations: SupplierBrandRelation[];
    autoSendConfig: AutoSendConfig;
}
export declare const DEFAULT_CATEGORIES: BrandCategory[];
