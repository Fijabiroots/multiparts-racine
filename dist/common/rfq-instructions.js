"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RFQ_INSTRUCTIONS_EN = exports.RFQ_INSTRUCTIONS_FR = void 0;
exports.getRfqInstructions = getRfqInstructions;
exports.detectLanguageFromEmail = detectLanguageFromEmail;
exports.detectLanguageFromText = detectLanguageFromText;
exports.RFQ_INSTRUCTIONS_FR = `
<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">

<h3 style="color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 5px;">
📋 Instructions RFQ – MULTIPARTS
</h3>

<p>Merci de bien vouloir nous transmettre votre <strong>meilleure offre commerciale et technique</strong> en incluant obligatoirement les éléments suivants :</p>

<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #3498db;">
<strong>1️⃣ Prix</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Prix unitaire pour chaque article</li>
<li>Prix total de l'offre</li>
<li>Devise clairement indiquée (EUR / USD / autre)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #2ecc71;">
<strong>2️⃣ Incoterm</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Ex-Works (EXW) ou <strong>CIF Abidjan</strong> si possible</li>
<li>Préciser le lieu EXW exact (ville, pays)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #e74c3c;">
<strong>3️⃣ Logistique</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Poids total de l'offre (kg)</li>
<li>Dimensions et nombre de colis si disponibles</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #9b59b6;">
<strong>4️⃣ Technique</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Fiche technique et/ou plans</li>
<li>Références constructeur exactes</li>
<li>Normes et certifications applicables (ex. ISO, API, ATEX, etc.)</li>
<li>Certificats requis le cas échéant (ex. EN 10204 3.1)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #f39c12;">
<strong>5️⃣ Délais</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Délai de livraison (fabrication + expédition), exprimé clairement</li>
<li>Validité de l'offre (ex. 30 / 60 / 90 jours)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #1abc9c;">
<strong>6️⃣ Conditions commerciales</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Conditions de paiement proposées</li>
<li>Origine des produits (pays)</li>
</ul>
</td>
</tr>

</table>

</div>
`;
exports.RFQ_INSTRUCTIONS_EN = `
<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">

<h3 style="color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 5px;">
📋 RFQ Instructions – MULTIPARTS
</h3>

<p>Please provide your <strong>best commercial and technical offer</strong> including the following mandatory elements:</p>

<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #3498db;">
<strong>1️⃣ Pricing</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Unit price for each item</li>
<li>Total offer price</li>
<li>Currency clearly indicated (EUR / USD / other)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #2ecc71;">
<strong>2️⃣ Incoterm</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Ex-Works (EXW) or <strong>CIF Abidjan</strong> if possible</li>
<li>Specify exact EXW location (city, country)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #e74c3c;">
<strong>3️⃣ Logistics</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Total weight of the offer (kg)</li>
<li>Dimensions and number of packages if available</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #9b59b6;">
<strong>4️⃣ Technical</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Technical data sheet and/or drawings</li>
<li>Exact manufacturer references</li>
<li>Applicable standards and certifications (e.g. ISO, API, ATEX, etc.)</li>
<li>Required certificates if applicable (e.g. EN 10204 3.1)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #f8f9fa; border-left: 4px solid #f39c12;">
<strong>5️⃣ Lead Times</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Delivery time (manufacturing + shipping), clearly stated</li>
<li>Offer validity (e.g. 30 / 60 / 90 days)</li>
</ul>
</td>
</tr>

<tr>
<td style="vertical-align: top; padding: 10px; background: #fff; border-left: 4px solid #1abc9c;">
<strong>6️⃣ Commercial Terms</strong>
<ul style="margin: 5px 0; padding-left: 20px;">
<li>Proposed payment terms</li>
<li>Country of origin of products</li>
</ul>
</td>
</tr>

</table>

</div>
`;
function getRfqInstructions(language = 'both') {
    switch (language) {
        case 'fr':
            return exports.RFQ_INSTRUCTIONS_FR;
        case 'en':
            return exports.RFQ_INSTRUCTIONS_EN;
        case 'both':
        default:
            return `
${exports.RFQ_INSTRUCTIONS_FR}

<hr style="border: none; border-top: 2px dashed #ccc; margin: 30px 0;">

${exports.RFQ_INSTRUCTIONS_EN}
`;
    }
}
function detectLanguageFromEmail(email) {
    const domain = email.toLowerCase().split('@')[1] || '';
    const frenchDomains = ['.fr', '.be', '.ch', '.ca', '.lu', '.mc', '.sn', '.ci', '.ml', '.bf', '.ne', '.tg', '.bj', '.ga', '.cg', '.cd', '.cm', '.mg', '.dj', '.ht'];
    const englishDomains = ['.uk', '.us', '.au', '.nz', '.ie', '.za', '.ng', '.gh', '.ke', '.in', '.sg', '.hk', '.ph'];
    for (const ext of frenchDomains) {
        if (domain.endsWith(ext))
            return 'fr';
    }
    for (const ext of englishDomains) {
        if (domain.endsWith(ext))
            return 'en';
    }
    return 'both';
}
function detectLanguageFromText(text) {
    const lowerText = text.toLowerCase();
    const frenchKeywords = ['bonjour', 'merci', 'demande', 'prix', 'offre', 'livraison', 'commande', 'besoin', 'urgent', 'cordialement'];
    const englishKeywords = ['hello', 'thank', 'request', 'quote', 'delivery', 'order', 'need', 'urgent', 'regards', 'please'];
    let frScore = 0;
    let enScore = 0;
    for (const kw of frenchKeywords) {
        if (lowerText.includes(kw))
            frScore++;
    }
    for (const kw of englishKeywords) {
        if (lowerText.includes(kw))
            enScore++;
    }
    if (frScore > enScore + 2)
        return 'fr';
    if (enScore > frScore + 2)
        return 'en';
    return 'both';
}
//# sourceMappingURL=rfq-instructions.js.map