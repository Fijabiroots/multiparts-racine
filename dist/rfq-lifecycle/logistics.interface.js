"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNTRY_CODES = exports.LOGISTICS_PATTERNS = void 0;
exports.extractLogisticsFromText = extractLogisticsFromText;
exports.LOGISTICS_PATTERNS = {
    weight: [
        /(?:poids|weight|gross\s*weight|net\s*weight)[:\s]*(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?)/i,
        /(\d+(?:[.,]\d+)?)\s*(?:kg|kgs)\s*(?:net|gross|total)?/i,
    ],
    incoterm: [
        /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/i,
        /incoterm[:\s]*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)/i,
    ],
    shipping: [
        /(?:shipping|expédition|transport)[:\s]*(sea|air|express|bateau|avion|maritime|aérien)/i,
        /(?:by|par|via)\s*(sea|air|express|ship|plane|bateau|avion)/i,
    ],
    hsCode: [
        /(?:hs|sh|tariff|customs)\s*(?:code)?[:\s]*(\d{4,10})/i,
        /\b(\d{4}\.\d{2}(?:\.\d{2})?)\b/,
    ],
    origin: [
        /(?:origin|origine|made\s*in|from)[:\s]*([A-Za-z\s]+?)(?:\.|,|$|\n)/i,
        /(?:country|pays)[:\s]*([A-Za-z\s]+?)(?:\.|,|$|\n)/i,
    ],
    dimensions: [
        /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm|mm)/i,
        /(?:dim|dimensions?)[:\s]*(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)/i,
    ],
};
function extractLogisticsFromText(text) {
    const info = {};
    for (const pattern of exports.LOGISTICS_PATTERNS.weight) {
        const match = text.match(pattern);
        if (match) {
            info.totalWeightKg = parseFloat(match[1].replace(',', '.'));
            break;
        }
    }
    for (const pattern of exports.LOGISTICS_PATTERNS.incoterm) {
        const match = text.match(pattern);
        if (match) {
            info.incoterm = match[1].toUpperCase();
            break;
        }
    }
    for (const pattern of exports.LOGISTICS_PATTERNS.shipping) {
        const match = text.match(pattern);
        if (match) {
            const mode = match[1].toLowerCase();
            if (mode.includes('sea') || mode.includes('bateau') || mode.includes('maritime')) {
                info.proposedShippingMode = 'Bateau';
            }
            else if (mode.includes('air') || mode.includes('avion') || mode.includes('aérien')) {
                info.proposedShippingMode = 'Avion';
            }
            else if (mode.includes('express')) {
                info.proposedShippingMode = 'Express';
            }
            break;
        }
    }
    for (const pattern of exports.LOGISTICS_PATTERNS.hsCode) {
        const match = text.match(pattern);
        if (match) {
            info.hsCode = match[1];
            break;
        }
    }
    for (const pattern of exports.LOGISTICS_PATTERNS.origin) {
        const match = text.match(pattern);
        if (match) {
            info.countryOfOrigin = match[1].trim();
            break;
        }
    }
    for (const pattern of exports.LOGISTICS_PATTERNS.dimensions) {
        const match = text.match(pattern);
        if (match) {
            info.dimensions = {
                lengthCm: parseFloat(match[1].replace(',', '.')),
                widthCm: parseFloat(match[2].replace(',', '.')),
                heightCm: parseFloat(match[3].replace(',', '.')),
            };
            info.volumetricWeightKg = (info.dimensions.lengthCm * info.dimensions.widthCm * info.dimensions.heightCm) / 5000;
            break;
        }
    }
    return info;
}
exports.COUNTRY_CODES = {
    'france': 'FR',
    'germany': 'DE',
    'allemagne': 'DE',
    'italy': 'IT',
    'italie': 'IT',
    'spain': 'ES',
    'espagne': 'ES',
    'uk': 'GB',
    'united kingdom': 'GB',
    'royaume-uni': 'GB',
    'usa': 'US',
    'united states': 'US',
    'états-unis': 'US',
    'china': 'CN',
    'chine': 'CN',
    'japan': 'JP',
    'japon': 'JP',
    'india': 'IN',
    'inde': 'IN',
    'turkey': 'TR',
    'turquie': 'TR',
    'netherlands': 'NL',
    'pays-bas': 'NL',
    'belgium': 'BE',
    'belgique': 'BE',
    'switzerland': 'CH',
    'suisse': 'CH',
    'south korea': 'KR',
    'corée du sud': 'KR',
    'taiwan': 'TW',
    'brazil': 'BR',
    'brésil': 'BR',
    'south africa': 'ZA',
    'afrique du sud': 'ZA',
    'uae': 'AE',
    'emirats': 'AE',
};
//# sourceMappingURL=logistics.interface.js.map