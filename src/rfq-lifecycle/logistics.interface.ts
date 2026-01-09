import { ShippingMode } from '../common/company-info';

/**
 * Informations logistiques d'une offre fournisseur
 */
export interface LogisticsInfo {
  // Poids
  totalWeightKg?: number;
  volumetricWeightKg?: number;
  
  // Dimensions (pour calcul poids volumétrique)
  dimensions?: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  
  // Incoterm
  incoterm?: string;
  
  // Mode d'expédition proposé par le fournisseur
  proposedShippingMode?: ShippingMode | string;
  
  // Code HS/SH (Harmonized System)
  hsCode?: string;
  
  // Pays d'origine / départ
  countryOfOrigin?: string;
  countryCode?: string;
  
  // Port/aéroport de départ
  departurePort?: string;
  
  // Délai d'expédition
  shippingDays?: number;
  
  // Notes logistiques
  logisticsNotes?: string;
}

/**
 * Recommandation d'expédition
 */
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
    sea?: number;      // ~30-45 jours
    air?: number;      // ~5-7 jours
    express?: number;  // ~3-5 jours
  };
}

/**
 * Résumé logistique pour le comparatif
 */
export interface LogisticsSummary {
  supplierEmail: string;
  supplierName?: string;
  
  // Infos principales
  totalWeightKg?: number;
  incoterm?: string;
  shippingMode?: string;
  hsCode?: string;
  countryOfOrigin?: string;
  
  // Recommandation
  recommendation?: ShippingRecommendation;
}

/**
 * Patterns pour extraire les infos logistiques du texte
 */
export const LOGISTICS_PATTERNS = {
  // Poids
  weight: [
    /(?:poids|weight|gross\s*weight|net\s*weight)[:\s]*(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:kg|kgs)\s*(?:net|gross|total)?/i,
  ],
  
  // Incoterms
  incoterm: [
    /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/i,
    /incoterm[:\s]*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)/i,
  ],
  
  // Mode d'expédition
  shipping: [
    /(?:shipping|expédition|transport)[:\s]*(sea|air|express|bateau|avion|maritime|aérien)/i,
    /(?:by|par|via)\s*(sea|air|express|ship|plane|bateau|avion)/i,
  ],
  
  // Code HS
  hsCode: [
    /(?:hs|sh|tariff|customs)\s*(?:code)?[:\s]*(\d{4,10})/i,
    /\b(\d{4}\.\d{2}(?:\.\d{2})?)\b/,
  ],
  
  // Pays d'origine
  origin: [
    /(?:origin|origine|made\s*in|from)[:\s]*([A-Za-z\s]+?)(?:\.|,|$|\n)/i,
    /(?:country|pays)[:\s]*([A-Za-z\s]+?)(?:\.|,|$|\n)/i,
  ],
  
  // Dimensions
  dimensions: [
    /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm|mm)/i,
    /(?:dim|dimensions?)[:\s]*(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)/i,
  ],
};

/**
 * Extraire les informations logistiques d'un texte
 */
export function extractLogisticsFromText(text: string): LogisticsInfo {
  const info: LogisticsInfo = {};
  
  // Poids
  for (const pattern of LOGISTICS_PATTERNS.weight) {
    const match = text.match(pattern);
    if (match) {
      info.totalWeightKg = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }
  
  // Incoterm
  for (const pattern of LOGISTICS_PATTERNS.incoterm) {
    const match = text.match(pattern);
    if (match) {
      info.incoterm = match[1].toUpperCase();
      break;
    }
  }
  
  // Mode d'expédition
  for (const pattern of LOGISTICS_PATTERNS.shipping) {
    const match = text.match(pattern);
    if (match) {
      const mode = match[1].toLowerCase();
      if (mode.includes('sea') || mode.includes('bateau') || mode.includes('maritime')) {
        info.proposedShippingMode = 'Bateau';
      } else if (mode.includes('air') || mode.includes('avion') || mode.includes('aérien')) {
        info.proposedShippingMode = 'Avion';
      } else if (mode.includes('express')) {
        info.proposedShippingMode = 'Express';
      }
      break;
    }
  }
  
  // Code HS
  for (const pattern of LOGISTICS_PATTERNS.hsCode) {
    const match = text.match(pattern);
    if (match) {
      info.hsCode = match[1];
      break;
    }
  }
  
  // Pays d'origine
  for (const pattern of LOGISTICS_PATTERNS.origin) {
    const match = text.match(pattern);
    if (match) {
      info.countryOfOrigin = match[1].trim();
      break;
    }
  }
  
  // Dimensions
  for (const pattern of LOGISTICS_PATTERNS.dimensions) {
    const match = text.match(pattern);
    if (match) {
      info.dimensions = {
        lengthCm: parseFloat(match[1].replace(',', '.')),
        widthCm: parseFloat(match[2].replace(',', '.')),
        heightCm: parseFloat(match[3].replace(',', '.')),
      };
      // Calculer le poids volumétrique
      info.volumetricWeightKg = (info.dimensions.lengthCm * info.dimensions.widthCm * info.dimensions.heightCm) / 5000;
      break;
    }
  }
  
  return info;
}

/**
 * Codes pays courants
 */
export const COUNTRY_CODES: Record<string, string> = {
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
