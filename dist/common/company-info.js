"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShippingMode = exports.INCOTERMS = exports.COMPANY_INFO = void 0;
exports.getCompanyHeader = getCompanyHeader;
exports.getAddressBlock = getAddressBlock;
exports.recommendShippingMode = recommendShippingMode;
exports.calculateVolumetricWeight = calculateVolumetricWeight;
exports.getFullAddress = getFullAddress;
exports.getEmailSignature = getEmailSignature;
exports.COMPANY_INFO = {
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
    defaultPort: 'Abidjan, Côte d\'Ivoire',
    defaultIncoterm: 'CIF Abidjan',
};
function getCompanyHeader() {
    const addr = exports.COMPANY_INFO.address;
    const c = exports.COMPANY_INFO.contact;
    return `
<div style="font-family: Arial, sans-serif; padding: 15px; background: linear-gradient(135deg, #1a5276 0%, #2980b9 100%); color: white; border-radius: 8px; margin-bottom: 20px;">
  <table style="width: 100%;">
    <tr>
      <td style="vertical-align: middle;">
        <h2 style="margin: 0; font-size: 24px;">${exports.COMPANY_INFO.name}</h2>
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
function getAddressBlock() {
    const addr = exports.COMPANY_INFO.address;
    const c = exports.COMPANY_INFO.contact;
    return `
<div style="font-family: Arial, sans-serif; padding: 15px; background: #f8f9fa; border-left: 4px solid #1a5276; margin: 15px 0;">
  <strong>${exports.COMPANY_INFO.name}</strong><br>
  ${addr.line1}<br>
  ${addr.line2}<br>
  ${addr.city}, ${addr.country}<br><br>
  <strong>Contact:</strong> ${c.name} - ${c.title}<br>
  Tél: ${c.phone} | Mobile: ${c.mobile}<br>
  Email: <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
</div>
`;
}
exports.INCOTERMS = [
    'EXW',
    'FCA',
    'FAS',
    'FOB',
    'CFR',
    'CIF',
    'CPT',
    'CIP',
    'DAP',
    'DPU',
    'DDP',
];
var ShippingMode;
(function (ShippingMode) {
    ShippingMode["SEA"] = "Bateau";
    ShippingMode["AIR"] = "Avion";
    ShippingMode["EXPRESS"] = "Express";
    ShippingMode["ROAD"] = "Route";
    ShippingMode["RAIL"] = "Rail";
    ShippingMode["MULTIMODAL"] = "Multimodal";
})(ShippingMode || (exports.ShippingMode = ShippingMode = {}));
function recommendShippingMode(weightKg, volumetricWeightKg, isUrgent) {
    const effectiveWeight = Math.max(weightKg, volumetricWeightKg || 0);
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
function calculateVolumetricWeight(lengthCm, widthCm, heightCm, mode = 'air') {
    const divisor = mode === 'express' ? 6000 : 5000;
    return (lengthCm * widthCm * heightCm) / divisor;
}
function getFullAddress() {
    const addr = exports.COMPANY_INFO.address;
    return `${addr.line1}\n${addr.line2}\n${addr.city}, ${addr.country}`;
}
function getEmailSignature() {
    const c = exports.COMPANY_INFO.contact;
    const addr = exports.COMPANY_INFO.address;
    return `
--
${c.name}
${c.title}
${exports.COMPANY_INFO.name}

${addr.line1}
${addr.line2}
${addr.city}, ${addr.country}

Tél: ${c.phone}
Mobile: ${c.mobile}
Email: ${c.primaryEmail}
`;
}
//# sourceMappingURL=company-info.js.map