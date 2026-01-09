"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PdfService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfService = void 0;
const common_1 = require("@nestjs/common");
const pdfParse = require('pdf-parse');
let PdfService = PdfService_1 = class PdfService {
    constructor() {
        this.logger = new common_1.Logger(PdfService_1.name);
    }
    async extractFromBuffer(buffer, filename) {
        try {
            const data = await pdfParse(buffer);
            const text = data.text;
            this.logger.debug(`Texte extrait de ${filename} (${text.length} chars)`);
            const rfqNumber = this.extractPRNumber(text, filename);
            const items = this.extractPurchaseRequisitionItems(text);
            this.logger.log(`${items.length} items extraits de ${filename}`);
            const additionalInfo = this.extractAdditionalInfo(text);
            return {
                filename,
                text: data.text,
                pages: data.numpages,
                items,
                rfqNumber,
                generalDescription: additionalInfo.generalDescription,
                additionalDescription: additionalInfo.additionalDescription,
                fleetNumber: additionalInfo.fleetNumber,
                serialNumber: additionalInfo.serialNumber,
                recommendedSuppliers: additionalInfo.recommendedSuppliers,
            };
        }
        catch (error) {
            this.logger.error(`Erreur extraction PDF ${filename}:`, error.message);
            throw error;
        }
    }
    async extractFromAttachment(attachment) {
        return this.extractFromBuffer(attachment.content, attachment.filename);
    }
    async extractFromAttachments(attachments) {
        const pdfAttachments = attachments.filter((att) => att.contentType === 'application/pdf' || att.filename?.toLowerCase().endsWith('.pdf'));
        const results = [];
        for (const attachment of pdfAttachments) {
            try {
                const extracted = await this.extractFromAttachment(attachment);
                if (extracted.items.length > 0) {
                    results.push(extracted);
                }
                else {
                    this.logger.warn(`Aucun item extrait de ${attachment.filename}, ajout item générique`);
                    results.push({
                        ...extracted,
                        items: [{
                                description: `Voir document joint: ${attachment.filename}`,
                                quantity: 1,
                                unit: 'pcs',
                                notes: 'Consultez le PDF pour les détails',
                            }],
                    });
                }
            }
            catch (error) {
                this.logger.warn(`Impossible d'extraire ${attachment.filename}: ${error.message}`);
            }
        }
        return results;
    }
    extractPRNumber(text, filename) {
        const prMatch1 = text.match(/Purchase\s+Requisition\s*No[:\s]+([A-Z]*-?\d+)/i);
        if (prMatch1) {
            return prMatch1[1].startsWith('PR') ? prMatch1[1] : `PR-${prMatch1[1]}`;
        }
        const prMatch2 = text.match(/Purchase\s+Requisitions?\s+No[:\s]+(\d+)/i);
        if (prMatch2) {
            return `PR-${prMatch2[1]}`;
        }
        const filenameMatch = filename.match(/PR[\s_\-]*(\d+)/i);
        if (filenameMatch) {
            return `PR-${filenameMatch[1]}`;
        }
        const genericMatch = text.match(/PR[\s\-_]*(\d+)/i);
        if (genericMatch) {
            return `PR-${genericMatch[1]}`;
        }
        return undefined;
    }
    extractAdditionalInfo(text) {
        const result = {};
        const generalMatch = text.match(/General\s+Description[:\s]+([^\n]+)/i);
        if (generalMatch) {
            result.generalDescription = generalMatch[1].trim();
        }
        const additionalMatch = text.match(/Additional\s+Description[:\s]+([^\n]+)/i);
        if (additionalMatch) {
            result.additionalDescription = additionalMatch[1].trim();
        }
        const fleetMatch = text.match(/Fleet\s+Number[:\s]+([A-Z0-9]+)/i);
        if (fleetMatch) {
            result.fleetNumber = fleetMatch[1].trim();
        }
        const serialMatch = text.match(/SERIAL\s*[:\s]+([A-Z0-9]+)/i);
        if (serialMatch) {
            result.serialNumber = serialMatch[1].trim();
        }
        const supplierMatch = text.match(/Recommended\s+supplier[^:]*[:\s]+([^\n]+)/i);
        if (supplierMatch) {
            result.recommendedSuppliers = supplierMatch[1]
                .split(/[;,]/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        }
        return result;
    }
    extractPurchaseRequisitionItems(text) {
        const items = [];
        const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = cleanText.split('\n');
        this.logger.debug(`Analyse de ${lines.length} lignes pour extraction items`);
        const additionalInfo = this.extractAdditionalInfo(text);
        const brandFromAdditional = this.extractBrandFromText(additionalInfo.additionalDescription || '');
        const brandFromGeneral = this.extractBrandFromText(additionalInfo.generalDescription || '');
        const detectedBrand = brandFromAdditional || brandFromGeneral;
        const foundItems = new Map();
        const mainLinePattern = /\b(\d{1,2})(\d{1,4})(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)(\d{5,8})([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s*1500\d+|\s+\d+\s*USD|\s*$)/gi;
        const spacedPattern = /\b(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s+1500\d+|\s+\d+\s+\d+\s*(USD|EUR|XOF)?|\s*$)/gi;
        let match;
        while ((match = mainLinePattern.exec(cleanText)) !== null) {
            const lineNum = match[1];
            const qty = parseInt(match[2], 10);
            const unit = match[3];
            const itemCode = match[4];
            let description = match[5].trim();
            description = description.replace(/\s*1500\d+.*$/i, '').trim();
            description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
            description = description.replace(/\s+0\s+0\s*$/i, '').trim();
            description = description.replace(/\s+\d+\s*USD.*$/i, '').trim();
            description = description.replace(/\s{2,}/g, ' ').trim();
            if (description.length > 5 && !foundItems.has(itemCode)) {
                foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
                this.logger.debug(`Item trouvé (compact): Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
            }
        }
        if (foundItems.size === 0) {
            while ((match = spacedPattern.exec(cleanText)) !== null) {
                const lineNum = match[1];
                const qty = parseInt(match[2], 10);
                const unit = match[3];
                const itemCode = match[4];
                let description = match[5].trim();
                description = description.replace(/\s+1500\d+.*$/i, '').trim();
                description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
                description = description.replace(/\s+0\s+0\s*$/i, '').trim();
                description = description.replace(/\s{2,}/g, ' ').trim();
                if (description.length > 5 && !foundItems.has(itemCode)) {
                    foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
                    this.logger.debug(`Item trouvé (espacé): Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
                }
            }
        }
        for (const [itemCode, data] of foundItems) {
            const itemIndex = cleanText.indexOf(itemCode);
            if (itemIndex > -1) {
                const afterItem = cleanText.substring(itemIndex);
                const continuationLines = [];
                const afterLines = afterItem.split('\n').slice(1);
                for (const contLine of afterLines) {
                    const trimmed = contLine.trim();
                    if (!trimmed ||
                        trimmed.match(/^(Additional|Total|Page|\d{1,3}\s+\d+\s+(EA|PCS))/i)) {
                        break;
                    }
                    if (trimmed.match(/^(Line|Quantity|UOM|Item|Sub|Activity|GL|Code|Cost|USD|EUR|XOF)/i)) {
                        continue;
                    }
                    if (trimmed.match(/^[A-Z]/i) && trimmed.length > 3) {
                        let addText = trimmed.replace(/\s+(USD|EUR|XOF).*$/i, '').trim();
                        addText = addText.replace(/\s+\d+\s*$/i, '').trim();
                        if (addText.length > 3) {
                            continuationLines.push(addText);
                        }
                    }
                }
                let fullDesc = data.desc;
                for (const cont of continuationLines) {
                    if (!fullDesc.toLowerCase().includes(cont.toLowerCase().substring(0, 15))) {
                        fullDesc += ' ' + cont;
                    }
                }
                const parts = fullDesc.split(' - ');
                if (parts.length === 2 && parts[0].toLowerCase().substring(0, 20) === parts[1].toLowerCase().substring(0, 20)) {
                    fullDesc = parts[0].trim();
                }
                fullDesc = fullDesc.replace(/\s{2,}/g, ' ').trim();
                const supplierCode = this.extractSupplierCodeFromDescription(fullDesc);
                const brand = detectedBrand || this.extractBrandFromDescription(fullDesc);
                this.logger.debug(`Item finalisé: Code=${itemCode}, SupplierCode=${supplierCode}, Brand=${brand}, Desc="${fullDesc.substring(0, 60)}..."`);
                items.push({
                    reference: supplierCode || itemCode,
                    internalCode: itemCode,
                    supplierCode: supplierCode,
                    brand: brand,
                    description: fullDesc,
                    quantity: data.qty,
                    unit: data.unit === 'EA' ? 'pcs' : data.unit.toLowerCase(),
                });
            }
        }
        if (items.length === 0) {
            this.logger.debug('Méthode principale sans résultat, essai méthode alternative');
            for (const line of lines) {
                const trimmed = line.trim();
                const altMatch = trimmed.match(/^(\d{1,2})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT)\s+(\d{5,6})\s+([A-Z].+)/i);
                if (altMatch) {
                    const qty = parseInt(altMatch[2], 10);
                    const unit = altMatch[3];
                    const itemCode = altMatch[4];
                    let description = altMatch[5].trim();
                    description = description.replace(/\s+1500\d+.*$/i, '').trim();
                    description = description.replace(/\s+\d+\s+(USD|EUR|XOF).*$/i, '').trim();
                    if (description.length > 5 && !items.some(i => i.internalCode === itemCode)) {
                        const supplierCode = this.extractSupplierCodeFromDescription(description);
                        const brand = detectedBrand || this.extractBrandFromDescription(description);
                        items.push({
                            reference: supplierCode || itemCode,
                            internalCode: itemCode,
                            supplierCode: supplierCode,
                            brand: brand,
                            description: description,
                            quantity: qty,
                            unit: unit === 'EA' ? 'pcs' : unit.toLowerCase(),
                        });
                    }
                }
            }
        }
        this.logger.log(`Extraction terminée: ${items.length} items trouvés`);
        return items;
    }
    extractSupplierCodeFromDescription(description) {
        const brandCodePattern = /\b(SCHNEIDER|SIEMENS|ABB|SKF|PARKER|CATERPILLAR|CAT|KOMATSU|SANDVIK|ATLAS|BOSCH|DANFOSS|EATON|GATES|TIMKEN|NSK|FAG|NTN|REXROTH|HYDAC|MAHLE|MANN|DONALDSON|FLEETGUARD|BALDWIN|WIX)\s+([A-Z0-9][\w\-\.\/]+)/i;
        const brandMatch = description.match(brandCodePattern);
        if (brandMatch) {
            return brandMatch[2];
        }
        const endCodePattern = /\b([A-Z]{2,}[\-]?[A-Z0-9]*[\d]+[A-Z0-9\-]*)\s*$/i;
        const endMatch = description.match(endCodePattern);
        if (endMatch && endMatch[1].length >= 4) {
            if (/\d/.test(endMatch[1])) {
                return endMatch[1];
            }
        }
        const specialCodePattern = /\b([A-Z]{1,3}[\-][A-Z0-9\-]+|[A-Z0-9]+[\-][A-Z0-9\-]+)\b/i;
        const specialMatch = description.match(specialCodePattern);
        if (specialMatch && specialMatch[1].length >= 5 && /\d/.test(specialMatch[1])) {
            return specialMatch[1];
        }
        return undefined;
    }
    extractBrandFromDescription(description) {
        const brands = [
            'SCHNEIDER', 'SIEMENS', 'ABB', 'SKF', 'PARKER', 'CATERPILLAR', 'CAT',
            'KOMATSU', 'SANDVIK', 'ATLAS COPCO', 'ATLAS', 'BOSCH', 'REXROTH',
            'DANFOSS', 'EATON', 'GATES', 'TIMKEN', 'NSK', 'FAG', 'NTN',
            'HYDAC', 'MAHLE', 'MANN', 'DONALDSON', 'FLEETGUARD', 'BALDWIN', 'WIX',
            'CUMMINS', 'PERKINS', 'DEUTZ', 'VOLVO', 'SCANIA', 'MERCEDES', 'MAN',
            'ZF', 'ALLISON', 'DANA', 'CARRARO', 'KAWASAKI', 'LINDE', 'LIEBHERR',
            'TEREX', 'GROVE', 'MANITOU', 'JCB', 'CASE', 'NEW HOLLAND', 'JOHN DEERE',
            'HITACHI', 'KOBELCO', 'SUMITOMO', 'HYUNDAI', 'DOOSAN', 'BOBCAT',
        ];
        const upperDesc = description.toUpperCase();
        for (const brand of brands) {
            if (upperDesc.includes(brand)) {
                return brand;
            }
        }
        return undefined;
    }
    extractBrandFromText(text) {
        if (!text)
            return undefined;
        return this.extractBrandFromDescription(text);
    }
    extractSupplierInfo(text) {
        const result = {};
        const companyPatterns = [
            /SOCIETE\s+DES\s+MINES\s+[^\n]+/i,
            /ENDEAVOUR\s+MINING/i,
            /Company[:\s]+([^\n]+)/i,
            /From[:\s]+([^\n<]+)/i,
        ];
        for (const pattern of companyPatterns) {
            const nameMatch = text.match(pattern);
            if (nameMatch) {
                result.name = nameMatch[0].trim();
                break;
            }
        }
        const supplierMatch = text.match(/Recommended\s+supplier[^:]*[:\s]+([^\n]+)/i);
        if (supplierMatch) {
            result.recommendedSuppliers = supplierMatch[1]
                .split(/[;,]/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        }
        const brands = new Set();
        const brandList = [
            'SCHNEIDER', 'SIEMENS', 'ABB', 'SKF', 'PARKER', 'CATERPILLAR', 'CAT',
            'KOMATSU', 'SANDVIK', 'ATLAS COPCO', 'ATLAS', 'BOSCH', 'REXROTH',
            'DANFOSS', 'EATON', 'GATES', 'TIMKEN', 'NSK', 'FAG', 'NTN',
            'HYDAC', 'MAHLE', 'MANN', 'DONALDSON', 'FLEETGUARD', 'BALDWIN', 'WIX',
        ];
        const upperText = text.toUpperCase();
        for (const brand of brandList) {
            if (upperText.includes(brand)) {
                brands.add(brand);
            }
        }
        if (brands.size > 0) {
            result.brands = Array.from(brands);
        }
        return result;
    }
    extractItemsFromEmailBody(body) {
        const items = [];
        if (!body)
            return items;
        const lines = body.split('\n').filter(l => l.trim());
        const patterns = [
            /^(\d+)\s*[xX×]\s*(.{10,})/,
            /^(.{10,}?)\s*:\s*(\d+)\s*(pcs?|unités?|ea)?/i,
            /^[-•]\s*(\d+)\s*[xX×]?\s*(.{10,})/,
            /^\d+[.\)]\s*(.{10,}?)\s*[-–:]\s*(\d+)/,
        ];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length < 10 || trimmed.length > 500)
                continue;
            for (const pattern of patterns) {
                const match = trimmed.match(pattern);
                if (match) {
                    let description;
                    let quantity;
                    if (pattern.source.startsWith('^(\\d+)')) {
                        quantity = parseInt(match[1], 10);
                        description = match[2].trim();
                    }
                    else {
                        description = match[1].trim();
                        quantity = parseInt(match[2], 10) || 1;
                    }
                    if (description.length > 5 && quantity > 0) {
                        items.push({
                            description,
                            quantity,
                            unit: 'pcs',
                        });
                        break;
                    }
                }
            }
        }
        return items;
    }
};
exports.PdfService = PdfService;
exports.PdfService = PdfService = PdfService_1 = __decorate([
    (0, common_1.Injectable)()
], PdfService);
//# sourceMappingURL=pdf.service.js.map