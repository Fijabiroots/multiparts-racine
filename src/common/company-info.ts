/**
 * Informations de la société MULTIPARTS CI
 */
export const COMPANY_INFO = {
  name: 'MULTIPARTS CI',
  fullName: 'MULTIPARTS',
  address: {
    line1: '2ᵉ étage, Immeuble Ganamet',
    line2: '4565 Boulevard Félix Houphouët-Boigny',
    city: 'Abidjan',
    country: 'Côte d\'Ivoire',
    countryCode: 'CI',
  },
  contact: {
    name: 'Rafiou OYEOSSI',
    title: 'Projects Manager',
    phone: '+225 27 21 25 01 46',
    mobile: '+225 07 09 39 95 26',
    emails: [
      'procurement@multipartsci.com',
      'rafiou.oyeossi@multipartsci.com',
    ],
    primaryEmail: 'procurement@multipartsci.com',
  },
  // Port de destination par défaut
  defaultPort: 'Abidjan, Côte d\'Ivoire',
  defaultIncoterm: 'CIF Abidjan',
};

/**
 * En-tête HTML pour les emails RFQ
 */
export function getCompanyHeader(): string {
  const addr = COMPANY_INFO.address;
  const c = COMPANY_INFO.contact;
  
  return `
<div style="font-family: Arial, sans-serif; padding: 15px; background: linear-gradient(135deg, #1a5276 0%, #2980b9 100%); color: white; border-radius: 8px; margin-bottom: 20px;">
  <table style="width: 100%;">
    <tr>
      <td style="vertical-align: middle;">
        <h2 style="margin: 0; font-size: 24px;">${COMPANY_INFO.name}</h2>
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.9;">
          ${addr.line1}<br>
          ${addr.line2}<br>
          ${addr.city}, ${addr.country}
        </p>
      </td>
      <td style="text-align: right; vertical-align: middle; font-size: 12px;">
        <p style="margin: 0;">
          <strong>${c.name}</strong><br>
          ${c.title}<br>
          📞 ${c.phone}<br>
          📱 ${c.mobile}<br>
          ✉️ ${c.primaryEmail}
        </p>
      </td>
    </tr>
  </table>
</div>
`;
}

/**
 * Bloc adresse simple pour corps d'email
 */
export function getAddressBlock(): string {
  const addr = COMPANY_INFO.address;
  const c = COMPANY_INFO.contact;
  
  return `
<div style="font-family: Arial, sans-serif; padding: 15px; background: #f8f9fa; border-left: 4px solid #1a5276; margin: 15px 0;">
  <strong>${COMPANY_INFO.name}</strong><br>
  ${addr.line1}<br>
  ${addr.line2}<br>
  ${addr.city}, ${addr.country}<br><br>
  <strong>Contact:</strong> ${c.name} - ${c.title}<br>
  Tél: ${c.phone} | Mobile: ${c.mobile}<br>
  Email: <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
</div>
`;
}

/**
 * Incoterms disponibles
 */
export const INCOTERMS = [
  'EXW',   // Ex Works
  'FCA',   // Free Carrier
  'FAS',   // Free Alongside Ship
  'FOB',   // Free On Board
  'CFR',   // Cost and Freight
  'CIF',   // Cost, Insurance and Freight
  'CPT',   // Carriage Paid To
  'CIP',   // Carriage and Insurance Paid To
  'DAP',   // Delivered at Place
  'DPU',   // Delivered at Place Unloaded
  'DDP',   // Delivered Duty Paid
];

/**
 * Modes d'expédition
 */
export enum ShippingMode {
  SEA = 'Bateau',
  AIR = 'Avion',
  EXPRESS = 'Express',
  ROAD = 'Route',
  RAIL = 'Rail',
  MULTIMODAL = 'Multimodal',
}

/**
 * Recommandation de mode d'expédition basée sur le poids
 */
export function recommendShippingMode(
  weightKg: number,
  volumetricWeightKg?: number,
  isUrgent?: boolean
): { 
  recommended: ShippingMode; 
  reason: string;
  alternatives: ShippingMode[];
} {
  // Poids effectif = max(poids réel, poids volumétrique)
  const effectiveWeight = Math.max(weightKg, volumetricWeightKg || 0);

  // Règles de recommandation
  if (effectiveWeight > 100) {
    return {
      recommended: ShippingMode.SEA,
      reason: `Poids > 100 kg (${effectiveWeight.toFixed(1)} kg) - Transport maritime recommandé`,
      alternatives: [ShippingMode.AIR],
    };
  }

  if (isUrgent && effectiveWeight <= 30) {
    return {
      recommended: ShippingMode.EXPRESS,
      reason: `Urgence + Poids léger (${effectiveWeight.toFixed(1)} kg) - Express recommandé`,
      alternatives: [ShippingMode.AIR, ShippingMode.SEA],
    };
  }

  if (effectiveWeight <= 30) {
    return {
      recommended: ShippingMode.EXPRESS,
      reason: `Poids léger (${effectiveWeight.toFixed(1)} kg) - Express possible`,
      alternatives: [ShippingMode.AIR, ShippingMode.SEA],
    };
  }

  if (effectiveWeight <= 100) {
    return {
      recommended: ShippingMode.AIR,
      reason: `Poids moyen (${effectiveWeight.toFixed(1)} kg) - Transport aérien recommandé`,
      alternatives: [ShippingMode.SEA, ShippingMode.EXPRESS],
    };
  }

  return {
    recommended: ShippingMode.SEA,
    reason: 'Par défaut - Transport maritime',
    alternatives: [ShippingMode.AIR],
  };
}

/**
 * Calcul du poids volumétrique
 * Formule standard: (L x l x H en cm) / 5000 pour aérien
 *                   (L x l x H en cm) / 6000 pour express
 */
export function calculateVolumetricWeight(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  mode: 'air' | 'express' = 'air'
): number {
  const divisor = mode === 'express' ? 6000 : 5000;
  return (lengthCm * widthCm * heightCm) / divisor;
}

/**
 * Format de l'adresse complète
 */
export function getFullAddress(): string {
  const addr = COMPANY_INFO.address;
  return `${addr.line1}\n${addr.line2}\n${addr.city}, ${addr.country}`;
}

/**
 * Signature email
 */
export function getEmailSignature(): string {
  const c = COMPANY_INFO.contact;
  const addr = COMPANY_INFO.address;
  return `
--
${c.name}
${c.title}
${COMPANY_INFO.name}

${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

Tél: ${c.phone}
Mobile: ${c.mobile}
Email: ${c.primaryEmail}
`;
}
