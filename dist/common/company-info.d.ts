export declare const COMPANY_INFO: {
    name: string;
    fullName: string;
    address: {
        line1: string;
        line2: string;
        city: string;
        country: string;
        countryCode: string;
    };
    contact: {
        name: string;
        title: string;
        phone: string;
        mobile: string;
        emails: string[];
        primaryEmail: string;
    };
    defaultPort: string;
    defaultIncoterm: string;
};
export declare function getCompanyHeader(): string;
export declare function getAddressBlock(): string;
export declare const INCOTERMS: string[];
export declare enum ShippingMode {
    SEA = "Bateau",
    AIR = "Avion",
    EXPRESS = "Express",
    ROAD = "Route",
    RAIL = "Rail",
    MULTIMODAL = "Multimodal"
}
export declare function recommendShippingMode(weightKg: number, volumetricWeightKg?: number, isUrgent?: boolean): {
    recommended: ShippingMode;
    reason: string;
    alternatives: ShippingMode[];
};
export declare function calculateVolumetricWeight(lengthCm: number, widthCm: number, heightCm: number, mode?: 'air' | 'express'): number;
export declare function getFullAddress(): string;
export declare function getEmailSignature(): string;
