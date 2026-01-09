import { BrandIntelligenceService } from './brand-intelligence.service';
import { AutoSendConfig } from './brand.interface';
export declare class BrandIntelligenceController {
    private readonly brandService;
    constructor(brandService: BrandIntelligenceService);
    getStatistics(): {
        success: boolean;
        data: any;
    };
    getCategories(): {
        success: boolean;
        data: import("./brand.interface").BrandCategory[];
    };
    searchBrands(query: string, limit?: string): {
        success: boolean;
        query: string;
        count: number;
        data: import("./brand.interface").Brand[];
    };
    getBrandsByCategory(categoryKey: string): {
        success: boolean;
        category: string;
        count: number;
        data: import("./brand.interface").Brand[];
    };
    getBrandDetail(name: string): {
        success: boolean;
        error: string;
        data?: undefined;
    } | {
        success: boolean;
        data: {
            brand: import("./brand.interface").Brand;
            suppliers: {
                email: string;
                name: string | undefined;
                reliability: number;
                quotesCount: number;
                isPreferred: boolean;
                lastQuoteAt: Date | undefined;
            }[];
        };
        error?: undefined;
    };
    addBrand(body: {
        name: string;
        category?: string;
    }): Promise<{
        success: boolean;
        message: string;
        data: import("./brand.interface").Brand;
    }>;
    updateBrandCategory(name: string, body: {
        category: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    detectBrands(body: {
        text: string;
    }): {
        success: boolean;
        detectedCount: number;
        data: string[];
    };
    analyzeRequest(body: {
        items: Array<{
            description: string;
            partNumber?: string;
            brand?: string;
        }>;
        additionalText?: string;
    }): {
        success: boolean;
        data: import("./brand.interface").BrandAnalysisResult;
    };
    getSupplierBrands(email: string): {
        success: boolean;
        supplier: string;
        brandsCount: number;
        data: {
            brand: string;
            reliability: number;
            quotesCount: number;
            successfulQuotes: number;
            declinedCount: number;
            isPreferred: boolean;
            lastQuoteAt: Date | undefined;
        }[];
    };
    recordSupplierResponse(body: {
        supplierEmail: string;
        supplierName?: string;
        brands: string[];
        isQuote: boolean;
        hasPrice?: boolean;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    getSuggestedSuppliers(brandsParam: string): {
        success: boolean;
        error: string;
        brands?: undefined;
        count?: undefined;
        data?: undefined;
    } | {
        success: boolean;
        brands: string[];
        count: number;
        data: import("./brand.interface").SupplierSuggestion[];
        error?: undefined;
    };
    getAutoSendConfig(): {
        success: boolean;
        data: AutoSendConfig;
    };
    updateAutoSendConfig(config: Partial<AutoSendConfig>): Promise<{
        success: boolean;
        message: string;
        data: AutoSendConfig;
    }>;
}
