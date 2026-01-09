"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DocumentParserService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentParserService = void 0;
const common_1 = require("@nestjs/common");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const mammoth = require("mammoth");
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
let DocumentParserService = DocumentParserService_1 = class DocumentParserService {
    constructor() {
        this.logger = new common_1.Logger(DocumentParserService_1.name);
        this.rfqPatterns = [
            /Purchase\s+Requisitions?\s+No[:\s]*(\d+)/gi,
            /PR[\s\-_]*(\d{6,})/gi,
            /(?:RFQ|RFP|REF|N°|No\.|Référence|Reference|Demande)\s*[:\-#]?\s*([A-Z0-9][\w\-\/]+)/gi,
            /(?:Quotation|Quote|Devis)\s*(?:Request)?\s*[:\-#]?\s*([A-Z0-9][\w\-\/]+)/gi,
            /([A-Z]{2,4}[\-\/]?\d{4,}[\-\/]?\d{0,4})/g,
        ];
    }
    async parseDocument(attachment) {
        const filename = attachment.filename.toLowerCase();
        try {
            if (filename.endsWith('.pdf')) {
                return this.parsePdf(attachment);
            }
            else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
                return this.parseExcel(attachment);
            }
            else if (filename.endsWith('.docx') || filename.endsWith('.doc')) {
                return this.parseWord(attachment);
            }
            else if (filename.match(/\.(png|jpg|jpeg|gif|bmp|tiff?)$/)) {
                return this.parseImage(attachment);
            }
            else {
                this.logger.warn(`Type de fichier non supporté: ${attachment.filename}`);
                return null;
            }
        }
        catch (error) {
            this.logger.error(`Erreur parsing ${attachment.filename}:`, error.message);
            return null;
        }
    }
    async parseAllAttachments(attachments) {
        const results = [];
        for (const attachment of attachments) {
            const parsed = await this.parseDocument(attachment);
            if (parsed) {
                results.push(parsed);
            }
        }
        return results;
    }
    parseEmailBody(body, subject) {
        const rfqItems = this.extractItemsFromEmailBody(body);
        const items = rfqItems.length > 0 ? rfqItems : this.extractItemsFromText(body);
        const rfqNumber = this.extractRfqNumber(subject + ' ' + body);
        const metadata = this.extractEmailMetadata(body);
        return {
            filename: 'email_body',
            type: 'email',
            text: body,
            items,
            rfqNumber,
            needsVerification: rfqItems.length > 0,
            extractionMethod: 'email_body',
            ...metadata,
        };
    }
    extractItemsFromEmailBody(body) {
        const items = [];
        const text = body.toLowerCase();
        let quantity = 1;
        const qtyPatterns = [
            /cotation\s+de\s+(\d+)\s+unit[ée]s?/i,
            /(\d+)\s+unit[ée]s?\s+de\s+ce/i,
            /commander\s+(\d+)\s+(?:unit[ée]s?|pi[èe]ces?|pcs)/i,
            /besoin\s+de\s+(\d+)\s+(?:unit[ée]s?|pi[èe]ces?)/i,
            /acqu[ée]rir\s+(\d+)\s+(?:unit[ée]s?|pi[èe]ces?)/i,
            /(\d+)\s+(?:unit[ée]s?|pi[èe]ces?|pcs)\s+(?:de|du|des)/i,
        ];
        for (const pattern of qtyPatterns) {
            const match = body.match(pattern);
            if (match) {
                quantity = parseInt(match[1], 10);
                break;
            }
        }
        const productPatterns = [
            /appareil\s+(?:d[ée]nomm[ée]|appel[ée])\s+([^.]+?)(?:\s+qui|\s+permet|\s+pour|,|\.|$)/i,
            /mat[ée]riel\s+(?:d[ée]nomm[ée]|appel[ée])\s+([^.]+?)(?:\s+qui|\s+permet|\s+pour|,|\.|$)/i,
            /(?:un|une|des)\s+([a-zéèàùâêîôûç\-]+(?:\s+(?:ou|\/)\s+[a-zéèàùâêîôûç\-]+)?)\s+(?:qui\s+permet|pour\s+mesurer|pour\s+le|servant)/i,
        ];
        let productName = '';
        for (const pattern of productPatterns) {
            const match = body.match(pattern);
            if (match) {
                productName = match[1].trim();
                break;
            }
        }
        const technicalTerms = [];
        const termPatterns = [
            /compact[\-\s]?m[eè]tre/gi,
            /p[ée]n[ée]trom[eè]tre/gi,
            /manom[eè]tre/gi,
            /thermom[eè]tre/gi,
            /hygrom[eè]tre/gi,
            /d[ée]bitm[eè]tre/gi,
            /voltm[eè]tre/gi,
            /amp[eè]rem[eè]tre/gi,
            /analyseur\s+[a-zéèàù]+/gi,
            /capteur\s+[a-zéèàù]+/gi,
            /pompe\s+[a-zéèàù]+/gi,
            /moteur\s+[a-zéèàù]+/gi,
            /filtre\s+[a-zéèàù]+/gi,
            /vanne\s+[a-zéèàù]+/gi,
        ];
        for (const pattern of termPatterns) {
            const matches = body.match(pattern);
            if (matches) {
                technicalTerms.push(...matches.map(m => m.toUpperCase()));
            }
        }
        let description = '';
        if (technicalTerms.length > 0) {
            description = [...new Set(technicalTerms)].join(' / ');
        }
        else if (productName) {
            description = productName.toUpperCase();
        }
        const usageMatch = body.match(/(?:qui\s+)?permet(?:tant)?\s+de\s+([^.]+)/i);
        if (usageMatch && description) {
            description += ` (${usageMatch[1].trim()})`;
        }
        if (description && quantity > 0) {
            const notes = [];
            if (/fiche\s+technique/i.test(body)) {
                notes.push('Fiche technique demandée');
            }
            if (/d[ée]lai\s+de\s+livraison/i.test(body)) {
                notes.push('Délai de livraison à préciser');
            }
            if (/urgent/i.test(body)) {
                notes.push('⚠️ URGENT');
            }
            if (/certificat/i.test(body)) {
                notes.push('Certificat demandé');
            }
            items.push({
                description: description,
                quantity: quantity,
                unit: 'pcs',
                notes: notes.length > 0 ? notes.join(' | ') : undefined,
                needsManualReview: true,
                isEstimated: false,
            });
        }
        return items;
    }
    extractEmailMetadata(body) {
        const result = {};
        const deadlinePatterns = [
            /d[ée]lai\s+de\s+r[ée]ponse[:\s]+([^.\n]+)/i,
            /r[ée]ponse\s+avant\s+le[:\s]+([^.\n]+)/i,
            /date\s+limite[:\s]+([^.\n]+)/i,
            /deadline[:\s]+([^.\n]+)/i,
        ];
        for (const pattern of deadlinePatterns) {
            const match = body.match(pattern);
            if (match) {
                result.deadline = match[1].trim();
                break;
            }
        }
        const nameMatch = body.match(/(?:cordialement|cdlt|regards|salutations)[,.\s]*\n+([A-ZÉÈÀÙÂÊÎÔÛÇ][A-ZÉÈÀÙÂÊÎÔÛÇ\s]+)\n/i);
        if (nameMatch) {
            result.contactName = nameMatch[1].trim();
        }
        const rolePatterns = [
            /(acheteur[\s\-]?(?:projet)?)/i,
            /(responsable\s+(?:achat|procurement|approvisionnement)[^\n]*)/i,
            /(buyer|procurement\s+(?:officer|manager)?)/i,
            /(chef\s+de\s+(?:projet|service)[^\n]*)/i,
        ];
        for (const pattern of rolePatterns) {
            const match = body.match(pattern);
            if (match) {
                result.contactRole = match[1].trim();
                break;
            }
        }
        const phoneMatch = body.match(/(?:CEL|TEL|T[ée]l|Mobile|Phone|GSM)[.\s:]*([0-9\s\-\.+]+)/i);
        if (phoneMatch) {
            result.contactPhone = phoneMatch[1].replace(/\s+/g, ' ').trim();
        }
        result.isUrgent = /urgent/i.test(body);
        return result;
    }
    async parsePdf(attachment) {
        let text = '';
        let needsVerification = false;
        let extractionMethod = '';
        try {
            text = await this.extractTextWithPdftotext(attachment.content);
            if (text && text.trim().length >= 50) {
                extractionMethod = 'pdftotext';
                this.logger.debug(`pdftotext extraction: ${text.length} caractères`);
            }
        }
        catch (error) {
            this.logger.warn(`pdftotext failed: ${error.message}`);
        }
        if (!text || text.trim().length < 50) {
            try {
                const pdfParseDefault = pdfParse.default || pdfParse;
                const data = await pdfParseDefault(attachment.content);
                if (data.text && data.text.trim().length > (text?.length || 0)) {
                    text = data.text;
                    extractionMethod = 'pdf-parse';
                    this.logger.debug(`pdf-parse extraction: ${text.length} caractères`);
                }
            }
            catch (error) {
                this.logger.warn(`pdf-parse failed: ${error.message}`);
            }
        }
        if (!text || text.trim().length < 50) {
            this.logger.log(`Document semble être un scan, tentative OCR: ${attachment.filename}`);
            try {
                text = await this.extractTextWithOcr(attachment.content);
                if (text && text.trim().length > 20) {
                    extractionMethod = 'ocr';
                    needsVerification = true;
                    this.logger.debug(`OCR extraction: ${text.length} caractères`);
                }
            }
            catch (error) {
                this.logger.warn(`OCR failed: ${error.message}`);
            }
        }
        let filenameInfo = {};
        if (!text || text.trim().length < 20) {
            filenameInfo = this.extractInfoFromFilename(attachment.filename);
            needsVerification = true;
            this.logger.warn(`Extraction minimale depuis le nom de fichier: ${attachment.filename}`);
        }
        const items = this.extractItemsFromText(text || '');
        let rfqNumber = this.extractRfqNumber(text || '') || filenameInfo.rfqNumber;
        if (needsVerification && items.length === 0 && filenameInfo.description) {
            items.push({
                reference: filenameInfo.rfqNumber,
                description: filenameInfo.description,
                quantity: 1,
                unit: 'lot',
                brand: filenameInfo.brand,
                notes: '⚠️ VÉRIFICATION REQUISE - Document scanné, extraction automatique limitée',
            });
        }
        if (needsVerification && items.length > 0) {
            items.forEach(item => {
                const verificationNote = '⚠️ VÉRIFICATION REQUISE - Extrait par OCR';
                item.notes = item.notes ? `${item.notes} | ${verificationNote}` : verificationNote;
                if (!item.brand && filenameInfo.brand) {
                    item.brand = filenameInfo.brand;
                }
            });
        }
        return {
            filename: attachment.filename,
            type: 'pdf',
            text: text || '',
            items,
            rfqNumber,
            needsVerification,
            extractionMethod,
        };
    }
    async extractTextWithPdftotext(buffer) {
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`);
        try {
            fs.writeFileSync(tempFile, buffer);
            const result = (0, child_process_1.execSync)(`pdftotext -layout "${tempFile}" -`, {
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30000,
            });
            return result;
        }
        finally {
            try {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            }
            catch (e) {
                this.logger.warn(`Erreur suppression fichier temp: ${e.message}`);
            }
        }
    }
    async extractTextWithOcr(buffer) {
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const tempPdf = path.join(tempDir, `ocr_${timestamp}.pdf`);
        const tempImg = path.join(tempDir, `ocr_${timestamp}.png`);
        const tempImgRotated = path.join(tempDir, `ocr_${timestamp}_rotated.png`);
        try {
            fs.writeFileSync(tempPdf, buffer);
            try {
                (0, child_process_1.execSync)(`pdftoppm -png -r 300 -singlefile "${tempPdf}" "${tempDir}/ocr_${timestamp}"`, {
                    timeout: 60000,
                });
            }
            catch (e) {
                this.logger.warn(`pdftoppm failed: ${e.message}`);
                return '';
            }
            if (!fs.existsSync(tempImg)) {
                this.logger.warn('Image conversion failed - no output file');
                return '';
            }
            let bestResult = '';
            let bestScore = 0;
            const rotations = [0, 90, 270, 180];
            for (const rotation of rotations) {
                let imgToUse = tempImg;
                if (rotation > 0) {
                    try {
                        (0, child_process_1.execSync)(`convert "${tempImg}" -rotate ${rotation} "${tempImgRotated}"`, { timeout: 30000 });
                        imgToUse = tempImgRotated;
                    }
                    catch (e) {
                        continue;
                    }
                }
                try {
                    const result = (0, child_process_1.execSync)(`tesseract "${imgToUse}" stdout -l fra+eng --psm 6 2>/dev/null`, {
                        encoding: 'utf-8',
                        timeout: 60000,
                        maxBuffer: 10 * 1024 * 1024,
                    });
                    const words = result.match(/[a-zA-ZÀ-ÿ]{3,}/g) || [];
                    const score = words.length;
                    if (score > bestScore) {
                        bestScore = score;
                        bestResult = result;
                        this.logger.debug(`OCR rotation ${rotation}°: ${score} mots détectés`);
                    }
                    if (score > 50)
                        break;
                }
                catch (e) {
                }
            }
            return bestResult || '';
        }
        finally {
            [tempPdf, tempImg, tempImgRotated].forEach(f => {
                try {
                    if (fs.existsSync(f))
                        fs.unlinkSync(f);
                }
                catch (e) { }
            });
        }
    }
    extractInfoFromFilename(filename) {
        const result = {};
        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
        const refPatterns = [
            /\b(BI)[_\-]?(\d{4,})/i,
            /\b(PR)[_\-]?(\d{4,})/i,
            /\b(RFQ|REF)[_\-]?(\d{4,})/i,
            /[_\-](\d{5,})[_\-]/,
        ];
        for (const pattern of refPatterns) {
            const match = nameWithoutExt.match(pattern);
            if (match) {
                if (match[2]) {
                    result.rfqNumber = `${match[1].toUpperCase()}-${match[2]}`;
                }
                else if (match[1]) {
                    result.rfqNumber = match[1];
                }
                break;
            }
        }
        let description = nameWithoutExt
            .replace(/^(BI|PR|RFQ|REF)[_\-]?\d+[_\-]?/i, '')
            .replace(/_+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const brandPatterns = [
            /\b(KOMATSU|CATERPILLAR|CAT|TEREX|VOLVO|HITACHI|LIEBHERR|SANDVIK|EPIROC|METSO|ATLAS COPCO|JOHN DEERE|BELL)\b/i,
        ];
        for (const pattern of brandPatterns) {
            const match = description.match(pattern);
            if (match) {
                result.brand = match[1].toUpperCase();
                break;
            }
        }
        if (description.length > 5) {
            result.description = description;
        }
        return result;
    }
    async parseExcel(attachment) {
        const workbook = XLSX.read(attachment.content, { type: 'buffer' });
        let allText = '';
        const allItems = [];
        const tables = [];
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            tables.push(jsonData);
            const textData = XLSX.utils.sheet_to_txt(sheet);
            allText += textData + '\n';
            const items = this.extractItemsFromExcelSheet(jsonData);
            allItems.push(...items);
        }
        const rfqNumber = this.extractRfqNumber(allText);
        return {
            filename: attachment.filename,
            type: 'excel',
            text: allText,
            items: allItems,
            tables,
            rfqNumber,
        };
    }
    extractItemsFromExcelSheet(data) {
        const items = [];
        if (data.length < 2)
            return items;
        const safeString = (val) => {
            if (val === null || val === undefined)
                return '';
            return String(val);
        };
        const safeLower = (val) => safeString(val).toLowerCase();
        const findColumnIndex = (rowLower, patterns, excludePatterns = []) => {
            for (let i = 0; i < rowLower.length; i++) {
                const cell = rowLower[i] || '';
                let excluded = false;
                for (const excl of excludePatterns) {
                    if (cell.includes(excl)) {
                        excluded = true;
                        break;
                    }
                }
                if (excluded)
                    continue;
                for (const pattern of patterns) {
                    if (cell.includes(pattern))
                        return i;
                }
            }
            return -1;
        };
        let headerRowIndex = -1;
        let headers = {};
        for (let i = 0; i < Math.min(20, data.length); i++) {
            const row = data[i];
            if (!row || !Array.isArray(row))
                continue;
            const rowLower = [];
            for (let j = 0; j < row.length; j++) {
                rowLower.push(safeLower(row[j]));
            }
            const descIndex = findColumnIndex(rowLower, ['désignation', 'designation', 'description', 'libellé', 'libelle', 'article', 'item', 'produit'], ['code']);
            const qtyIndex = findColumnIndex(rowLower, ['qte', 'qty', 'quantité', 'quantity', 'qté', 'sum of qty', 'total qty', 'demandées', 'commander']);
            const refIndex = findColumnIndex(rowLower, ['code article', 'code', 'réf', 'référence', 'reference', 'part number', 'part']);
            const diameterIndex = findColumnIndex(rowLower, ['diameter', 'diamètre', 'nominal', 'size', 'dimension']);
            const unitIndex = findColumnIndex(rowLower, ['unité', 'unit', 'uom']);
            if (descIndex !== -1 || (refIndex !== -1 && qtyIndex !== -1)) {
                headerRowIndex = i;
                headers = {
                    description: descIndex,
                    quantity: qtyIndex,
                    reference: refIndex,
                    unit: unitIndex,
                    diameter: diameterIndex,
                };
                this.logger.debug(`En-têtes Excel trouvés ligne ${i}: ${JSON.stringify(headers)}`);
                break;
            }
        }
        if (headerRowIndex === -1) {
            return this.extractItemsFromText(data.map(row => row?.join(' ') || '').join('\n'));
        }
        let lastDescription = '';
        for (let i = headerRowIndex + 1; i < data.length; i++) {
            const row = data[i];
            if (!row || !Array.isArray(row))
                continue;
            const hasContent = row.some(cell => cell !== null && cell !== undefined && safeString(cell).trim() !== '');
            if (!hasContent)
                continue;
            let description = '';
            if (headers.description !== -1 && headers.description < row.length) {
                description = safeString(row[headers.description]).trim();
            }
            if (!description) {
                for (let j = 0; j < row.length; j++) {
                    if (j === headers.reference || j === headers.quantity || j === headers.unit)
                        continue;
                    const val = safeString(row[j]).trim();
                    if (val.length > 10 && !/^\d+([.,]\d+)?$/.test(val)) {
                        description = val;
                        break;
                    }
                }
            }
            if (!description.trim() && lastDescription) {
                description = lastDescription;
            }
            else if (description.trim()) {
                lastDescription = description.trim();
            }
            const descLower = description.toLowerCase();
            if (descLower.includes('grand total') || descLower === 'total' ||
                descLower.includes('sous-total') || descLower.includes('subtotal') ||
                descLower.includes('responsable') || descLower.includes('directeur') ||
                descLower.includes('visa') || descLower.includes('magasin pdr') ||
                descLower.includes('forces speciales') || descLower.includes('entretien')) {
                continue;
            }
            if (!description || description.length < 3)
                continue;
            let fullDescription = description.trim();
            if (headers.diameter !== -1 && headers.diameter < row.length && row[headers.diameter]) {
                const diameter = safeString(row[headers.diameter]).trim();
                if (diameter && diameter !== '0' && diameter !== '0 mm') {
                    fullDescription = `${fullDescription} - ${diameter}`;
                }
            }
            let quantity = 0;
            if (headers.quantity !== -1 && headers.quantity < row.length) {
                quantity = this.parseQuantity(row[headers.quantity]);
            }
            if (quantity <= 0) {
                for (let j = 0; j < row.length; j++) {
                    if (j === headers.description || j === headers.reference)
                        continue;
                    const val = this.parseQuantity(row[j]);
                    if (val > 0 && val < 100000) {
                        quantity = val;
                        break;
                    }
                }
            }
            if (quantity <= 0)
                continue;
            let unit = 'pcs';
            if (headers.unit !== -1 && headers.unit < row.length) {
                const unitVal = safeLower(row[headers.unit]).trim();
                if (unitVal && unitVal.length < 10) {
                    unit = (unitVal === 'pce' || unitVal === 'pc' || unitVal === 'off' || unitVal === 'ea' || unitVal === 'each') ? 'pcs' : unitVal;
                }
            }
            const qtyStr = headers.quantity !== -1 && headers.quantity < row.length ? safeString(row[headers.quantity]) : '';
            if (qtyStr.toUpperCase().includes(' M')) {
                unit = 'm';
            }
            const item = {
                description: fullDescription,
                quantity: quantity,
                unit: unit,
            };
            if (headers.reference !== -1 && headers.reference < row.length) {
                const ref = safeString(row[headers.reference]).trim();
                if (ref && ref.length > 2 && !/^\d{1,2}$/.test(ref)) {
                    item.reference = ref;
                    item.supplierCode = ref;
                }
            }
            item.brand = this.extractBrandFromDesc(fullDescription);
            items.push(item);
        }
        this.logger.debug(`${items.length} items extraits du fichier Excel`);
        return items;
    }
    async parseWord(attachment) {
        const result = await mammoth.extractRawText({ buffer: attachment.content });
        const text = result.value;
        const items = this.extractItemsFromText(text);
        const rfqNumber = this.extractRfqNumber(text);
        return {
            filename: attachment.filename,
            type: 'word',
            text,
            items,
            rfqNumber,
        };
    }
    async parseImage(attachment) {
        let text = '';
        let extractionMethod = 'image_ocr';
        const items = [];
        const tmpDir = os.tmpdir();
        const tmpPath = path.join(tmpDir, `img_${Date.now()}_${attachment.filename}`);
        try {
            fs.writeFileSync(tmpPath, attachment.content);
            try {
                text = (0, child_process_1.execSync)(`tesseract "${tmpPath}" stdout -l eng+fra 2>/dev/null`, {
                    timeout: 30000,
                }).toString();
                this.logger.debug(`OCR image: ${text.length} caractères extraits`);
            }
            catch (ocrError) {
                this.logger.warn(`OCR image failed: ${ocrError.message}`);
            }
            const nameplateInfo = this.extractNameplateInfo(text, attachment.filename);
            if (nameplateInfo.partNumber || nameplateInfo.model) {
                const descParts = [];
                if (nameplateInfo.brand) {
                    descParts.push(nameplateInfo.brand);
                }
                if (nameplateInfo.description) {
                    descParts.push(nameplateInfo.description);
                }
                const item = {
                    description: descParts.join(' - ') || `Pièce détachée (voir image: ${attachment.filename})`,
                    quantity: 1,
                    unit: 'pcs',
                    supplierCode: nameplateInfo.partNumber,
                    brand: nameplateInfo.brand,
                    needsManualReview: true,
                    isEstimated: false,
                    originalLine: 0,
                };
                const notes = [];
                if (nameplateInfo.model)
                    notes.push(`Model: ${nameplateInfo.model}`);
                if (nameplateInfo.serial)
                    notes.push(`S/N: ${nameplateInfo.serial}`);
                if (nameplateInfo.equipment)
                    notes.push(`Équipement: ${nameplateInfo.equipment}`);
                if (notes.length > 0) {
                    item.notes = notes.join(' | ');
                }
                items.push(item);
            }
            else {
                items.push({
                    description: `Pièce à identifier (voir image: ${attachment.filename})`,
                    quantity: 1,
                    unit: 'pcs',
                    needsManualReview: true,
                    isEstimated: true,
                    originalLine: 0,
                    notes: '⚠️ OCR non concluant - vérification manuelle requise',
                });
            }
        }
        finally {
            try {
                if (fs.existsSync(tmpPath)) {
                    fs.unlinkSync(tmpPath);
                }
            }
            catch (e) {
            }
        }
        return {
            filename: attachment.filename,
            type: 'image',
            text: text || '',
            items,
            needsVerification: true,
            extractionMethod,
        };
    }
    extractNameplateInfo(ocrText, filename) {
        const result = {};
        const text = ocrText.toUpperCase();
        const fileUpper = filename.toUpperCase();
        const pnPatterns = [
            /P\/N[:\s]*([A-Z0-9\-\/\s]+)/i,
            /PART\s*(?:NO|NUMBER|#)?[:\s]*([A-Z0-9\-\/\s]+)/i,
            /(\d{3}\s*\d{4})/,
            /REF[:\s]*([A-Z0-9\-\/]+)/i,
        ];
        for (const pattern of pnPatterns) {
            const match = text.match(pattern);
            if (match) {
                result.partNumber = match[1].trim().replace(/\s+/g, ' ');
                break;
            }
        }
        const modelMatch = text.match(/MODEL[:\s]*([A-Z0-9\.\-\/]+)/i);
        if (modelMatch) {
            result.model = modelMatch[1].trim();
        }
        const serialPatterns = [
            /SERIAL[:\s]*([A-Z0-9]+)/i,
            /S\/N[:\s]*([A-Z0-9]+)/i,
            /SN[:\s]*([A-Z0-9]+)/i,
        ];
        for (const pattern of serialPatterns) {
            const match = text.match(pattern);
            if (match) {
                result.serial = match[1].trim();
                break;
            }
        }
        const brands = [
            'DANA', 'SPICER', 'TEREX', 'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI',
            'VOLVO', 'LIEBHERR', 'SANDVIK', 'EPIROC', 'ATLAS COPCO', 'JOHN DEERE',
            'CUMMINS', 'PERKINS', 'DEUTZ', 'SCANIA', 'MAN', 'MERCEDES', 'BOSCH',
            'PARKER', 'EATON', 'REXROTH', 'HYDRAULIC', 'ZF', 'ALLISON',
        ];
        for (const brand of brands) {
            if (text.includes(brand) || fileUpper.includes(brand)) {
                result.brand = brand;
                break;
            }
        }
        if (text.includes('SPICER') || text.includes('DANA')) {
            result.brand = 'DANA SPICER';
            result.description = 'OFF-HIGHWAY COMPONENT';
        }
        const equipmentFromFile = fileUpper.replace(/\.(PNG|JPG|JPEG|GIF|BMP|TIFF?)$/i, '');
        if (equipmentFromFile && equipmentFromFile !== result.brand) {
            result.equipment = equipmentFromFile;
        }
        return result;
    }
    extractItemsFromText(text) {
        const items = [];
        const lines = text.split('\n').filter(line => line.trim());
        const textLower = text.toLowerCase();
        const isPurchaseRequisition = textLower.includes('purchase requisition') ||
            textLower.includes('item code') ||
            textLower.includes('item description') ||
            text.match(/\b\d{1,2}\s+\d+\s+EA\s+\d{5,6}\s+[A-Z]/i);
        if (isPurchaseRequisition) {
            this.logger.log('Format Purchase Requisition détecté, extraction spécifique...');
            const prItems = this.extractPurchaseRequisitionItems(text);
            this.logger.log(`Extraction PR: ${prItems.length} items trouvés`);
            if (prItems.length > 0) {
                return prItems;
            }
        }
        const patterns = [
            /^([A-Z0-9][\w\-]+)\s*[-–:]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?|kg|m|l|pièces?|ea|each)?/i,
            /^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(.{10,})/,
            /^(.{10,}?)\s*:\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?|kg|m|l|pièces?|ea|each)?/i,
            /^\d+[.\)]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?)?/i,
            /^[-•]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)/,
        ];
        const seenDescriptions = new Set();
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length < 10 || trimmed.length > 500)
                continue;
            for (const pattern of patterns) {
                const match = trimmed.match(pattern);
                if (match) {
                    const item = this.parseMatchedItem(match, pattern);
                    if (item && item.description.length > 5 && !seenDescriptions.has(item.description.toLowerCase())) {
                        seenDescriptions.add(item.description.toLowerCase());
                        items.push(item);
                        break;
                    }
                }
            }
        }
        return items.slice(0, 100);
    }
    extractPurchaseRequisitionItems(text) {
        const items = [];
        this.logger.debug('=== Début extraction Purchase Requisition ===');
        const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = cleanText.split('\n');
        this.logger.debug('Essai méthode 0: Pattern direct global');
        const globalPattern = /\b(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s+1500\d+|\s+\d+\s+\d+\s*(USD|EUR|XOF)?|\s*$)/gi;
        let globalMatch;
        const foundItems = new Map();
        while ((globalMatch = globalPattern.exec(cleanText)) !== null) {
            const lineNum = globalMatch[1];
            const qty = parseInt(globalMatch[2], 10);
            const unit = globalMatch[3];
            const itemCode = globalMatch[4];
            let description = globalMatch[5].trim();
            description = description.replace(/\s+1500\d+.*$/i, '').trim();
            description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
            description = description.replace(/\s+0\s+0\s*$/i, '').trim();
            description = description.replace(/\s{2,}/g, ' ').trim();
            if (description.length > 5 && !foundItems.has(itemCode)) {
                foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
                this.logger.debug(`Méthode 0 - Item trouvé: Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
            }
        }
        if (foundItems.size > 0) {
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
                    const supplierCode = this.extractSupplierCodeFromDesc(fullDesc);
                    const brand = this.extractBrandFromDesc(fullDesc);
                    items.push({
                        reference: supplierCode || itemCode,
                        internalCode: itemCode,
                        supplierCode: supplierCode,
                        brand: brand,
                        description: fullDesc.replace(/\s{2,}/g, ' ').trim(),
                        quantity: data.qty,
                        unit: data.unit === 'EA' ? 'pcs' : data.unit.toLowerCase(),
                        originalLine: parseInt(data.lineNum, 10) || 0,
                    });
                }
            }
            if (items.length > 0) {
                this.logger.log(`Méthode 0: ${items.length} items extraits avec succès`);
                return items;
            }
        }
        if (cleanText.includes('Part Number')) {
            this.logger.debug('Format Part Number détecté');
            const partNumberPattern = /\b(\d{1,2})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT)\s+(\d{3,}\s+\d{3,}|\d{5,})\s+([A-Z][A-Z\s]+)/gi;
            let match;
            while ((match = partNumberPattern.exec(cleanText)) !== null) {
                const qty = parseInt(match[2], 10);
                const unit = match[3];
                const partNumber = match[4].replace(/\s+/g, ' ').trim();
                let description = match[5].trim();
                description = description.replace(/\s+Max\s+Stock.*$/i, '').trim();
                if (description.length > 3) {
                    this.logger.debug(`Item Part Number: PN=${partNumber}, Desc=${description}, Qty=${qty}`);
                    items.push({
                        reference: partNumber.replace(/\s+/g, ''),
                        supplierCode: partNumber,
                        description: description,
                        quantity: qty,
                        unit: unit === 'EA' ? 'pcs' : unit.toLowerCase(),
                    });
                }
            }
        }
        if (items.length === 0) {
            this.logger.debug('Essai extraction multi-ligne (pdftotext layout)');
            let currentItem = null;
            let collectingDescription = false;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                const mainLineMatch = line.match(/^\s*(\d{1,2})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT)\s+(\d{5,6})\s+(.+)/i);
                if (mainLineMatch) {
                    if (currentItem) {
                        const finalItem = this.finalizeMultilineItem(currentItem);
                        if (finalItem)
                            items.push(finalItem);
                    }
                    const qty = parseInt(mainLineMatch[2], 10);
                    const unit = mainLineMatch[3];
                    const itemCode = mainLineMatch[4];
                    let description = mainLineMatch[5].trim();
                    description = description.replace(/\s+1500\d+.*$/i, '').trim();
                    description = description.replace(/\s+\d+\s+(USD|EUR|XOF).*$/i, '').trim();
                    description = description.replace(/\s+0\s+0\s*$/i, '').trim();
                    currentItem = {
                        internalCode: itemCode,
                        description: description,
                        quantity: qty,
                        unit: unit === 'EA' ? 'pcs' : unit.toLowerCase(),
                        additionalLines: []
                    };
                    collectingDescription = true;
                    continue;
                }
                if (collectingDescription && currentItem) {
                    if (trimmed.startsWith('Additional Description') ||
                        trimmed.startsWith('Total in USD') ||
                        trimmed.startsWith('Page ')) {
                        collectingDescription = false;
                        continue;
                    }
                    if (trimmed === '')
                        continue;
                    if (trimmed.match(/^(Line|Quantity|UOM|Item|Sub|Activity|GL|Code|Cost)/i))
                        continue;
                    if (trimmed.match(/^(USD|EUR|XOF|\d+\s*(USD|EUR|XOF))$/i))
                        continue;
                    const textMatch = trimmed.match(/^([A-Z0-9][A-Z0-9\s\-\.\/\&\,]+)/i);
                    if (textMatch && textMatch[1].length > 3) {
                        let addText = textMatch[1].trim();
                        addText = addText.replace(/\s+USD.*$/i, '');
                        addText = addText.replace(/\s+\d+\s*$/i, '');
                        if (addText.length > 3) {
                            currentItem.additionalLines.push(addText);
                        }
                    }
                }
            }
            if (currentItem) {
                const finalItem = this.finalizeMultilineItem(currentItem);
                if (finalItem)
                    items.push(finalItem);
            }
        }
        if (items.length === 0) {
            this.logger.debug('Essai extraction par Item Code direct');
            for (const line of lines) {
                const codeMatch = line.match(/\b(\d{5,6})\s+([A-Z][A-Z0-9\s\-\.\/\&\,]+)/i);
                if (codeMatch) {
                    const itemCode = codeMatch[1];
                    let description = codeMatch[2].trim();
                    if (itemCode.startsWith('1500'))
                        continue;
                    if (description.match(/^(USD|EUR|XOF|Total|Cost|Max)/i))
                        continue;
                    description = description.replace(/\s+1500\d+.*$/i, '').trim();
                    description = description.replace(/\s+\d+\s*(USD|EUR|XOF).*$/i, '').trim();
                    description = description.replace(/\s+0\s*$/, '').trim();
                    if (description.length > 5 && !items.some(i => i.internalCode === itemCode)) {
                        const supplierCode = this.extractSupplierCodeFromDesc(description);
                        const brand = this.extractBrandFromDesc(description);
                        this.logger.debug(`Item direct: Code=${itemCode}, Desc=${description}`);
                        items.push({
                            reference: supplierCode || itemCode,
                            internalCode: itemCode,
                            supplierCode: supplierCode,
                            brand: brand,
                            description: description,
                            quantity: 1,
                            unit: 'pcs',
                        });
                    }
                }
            }
        }
        const additionalInfo = this.extractAdditionalDescription(cleanText);
        if (additionalInfo && items.length > 0) {
            this.logger.debug(`Additional Description trouvé: "${additionalInfo}"`);
            const brand = this.extractBrandFromDesc(additionalInfo);
            const serialMatch = additionalInfo.match(/SERIAL\s*:\s*([A-Z0-9]+)/i);
            const serial = serialMatch ? serialMatch[1] : undefined;
            items.forEach(item => {
                if (!item.brand && brand) {
                    item.brand = brand;
                }
                if (!item.notes && additionalInfo) {
                    item.notes = additionalInfo;
                }
                if (serial && !item.serialNumber) {
                    item.serialNumber = serial;
                }
            });
        }
        this.logger.log(`${items.length} items extraits du Purchase Requisition`);
        return items;
    }
    extractAdditionalDescription(text) {
        const lines = text.split('\n');
        let foundAdditional = false;
        const additionalContent = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.match(/^Additional\s*(Description)?/i)) {
                foundAdditional = true;
                const sameLine = trimmed.replace(/^Additional\s*(Description)?[:\s]*/i, '').trim();
                if (sameLine.length > 5 && !sameLine.match(/^HOD/i)) {
                    additionalContent.push(sameLine);
                }
                continue;
            }
            if (foundAdditional) {
                if (trimmed.match(/^\s*Line\s+Quantity/i) ||
                    trimmed.match(/^\s*\d{1,2}\s+\d+\s+(EA|PCS)/i) ||
                    trimmed.match(/^Total\s+in/i)) {
                    break;
                }
                if (trimmed.match(/^(HOD|signature|name\s*&)/i))
                    continue;
                if (trimmed === '')
                    continue;
                let content = trimmed.replace(/\s+HOD\s+name.*$/i, '').trim();
                content = content.replace(/\s+signature.*$/i, '').trim();
                if (content.length > 3) {
                    additionalContent.push(content);
                }
            }
        }
        return additionalContent.join(' ').replace(/\s{2,}/g, ' ').trim();
    }
    finalizeMultilineItem(item) {
        let fullDescription = item.description;
        for (const addLine of item.additionalLines) {
            if (!fullDescription.toLowerCase().includes(addLine.toLowerCase().substring(0, 10))) {
                fullDescription += ' ' + addLine;
            }
        }
        fullDescription = this.cleanPRDescription(fullDescription);
        if (fullDescription.length < 5)
            return null;
        const supplierCode = this.extractSupplierCodeFromDesc(fullDescription);
        const brand = this.extractBrandFromDesc(fullDescription);
        return {
            reference: supplierCode || item.internalCode,
            internalCode: item.internalCode,
            supplierCode: supplierCode,
            brand: brand,
            description: fullDescription,
            quantity: item.quantity,
            unit: item.unit,
        };
    }
    cleanPRDescription(desc) {
        desc = desc.replace(/\s+(USD|EUR|XOF)\s*/gi, ' ');
        desc = desc.replace(/\s+\d+\s+(USD|EUR|XOF)/gi, '');
        desc = desc.replace(/\s{2,}/g, ' ');
        const parts = desc.split(' - ');
        if (parts.length === 2) {
            const firstPart = parts[0].trim();
            const secondPart = parts[1].trim();
            if (secondPart.toLowerCase().startsWith(firstPart.substring(0, 15).toLowerCase())) {
                desc = firstPart;
            }
        }
        desc = desc.replace(/\s+0+\s*$/g, '');
        return desc.trim();
    }
    extractSupplierCodeFromDesc(description) {
        const patterns = [
            /\b([A-Z]{2,}[\-][A-Z0-9\-]+)\b/i,
            /\b([A-Z]{2,}\d+[A-Z0-9]*\/[A-Z0-9]+)\b/i,
            /\b(\d{3,}\s+\d{3,})\b/,
            /\b([A-Z]{2,}\d{3,}[A-Z0-9\-]*)\b/i,
        ];
        for (const pattern of patterns) {
            const match = description.match(pattern);
            if (match && match[1].length >= 5) {
                const code = match[1];
                if (!/^(USD|EUR|PCS|UNIT|TOTAL)$/i.test(code)) {
                    return code;
                }
            }
        }
        return undefined;
    }
    extractBrandFromDesc(description) {
        const knownBrands = [
            'TEREX', 'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI', 'VOLVO', 'LIEBHERR',
            'SANDVIK', 'EPIROC', 'METSO', 'ATLAS COPCO', 'JOHN DEERE', 'BELL',
            'SKF', 'FAG', 'NSK', 'NTN', 'TIMKEN', 'INA', 'KOYO',
            'SIEMENS', 'ABB', 'SCHNEIDER', 'ALLEN BRADLEY', 'ROCKWELL', 'OMRON',
            'PARKER', 'REXROTH', 'BOSCH', 'FESTO', 'SMC', 'EATON', 'VICKERS',
            'DANA', 'CARRARO', 'ZF', 'CLARK', 'ALLISON',
            'HTM', 'FLUKE', 'GATES', '3M', 'LOCTITE',
        ];
        const upperDesc = description.toUpperCase();
        for (const brand of knownBrands) {
            if (upperDesc.includes(brand)) {
                return brand;
            }
        }
        return undefined;
    }
    parseMatchedItem(match, pattern) {
        const patternStr = pattern.source;
        if (patternStr.includes('A-Z0-9') && patternStr.includes('[-–:]')) {
            return {
                reference: match[1]?.trim(),
                description: match[2]?.trim(),
                quantity: this.parseQuantity(match[3]),
                unit: match[4]?.trim(),
            };
        }
        if (patternStr.includes('[xX×]')) {
            return {
                description: match[2]?.trim(),
                quantity: this.parseQuantity(match[1]),
            };
        }
        if (patternStr.includes('\\s*:\\s*')) {
            return {
                description: match[1]?.trim(),
                quantity: this.parseQuantity(match[2]),
                unit: match[3]?.trim(),
            };
        }
        if (patternStr.includes('\\d+[.\\)]') || patternStr.includes('[-•]')) {
            return {
                description: match[1]?.trim(),
                quantity: this.parseQuantity(match[2]),
                unit: match[3]?.trim(),
            };
        }
        return null;
    }
    parseQuantity(value) {
        if (!value)
            return 1;
        const num = parseFloat(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
        return isNaN(num) || num <= 0 ? 1 : num;
    }
    extractRfqNumber(text) {
        for (const pattern of this.rfqPatterns) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                const candidate = match[1];
                if (candidate && candidate.length >= 4 && /\d/.test(candidate)) {
                    return candidate;
                }
            }
        }
        return undefined;
    }
    extractSupplierInfo(text) {
        const result = {};
        const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
        if (emailMatch) {
            result.email = emailMatch[0];
        }
        const phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/);
        if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 8) {
            result.phone = phoneMatch[0];
        }
        const companyPatterns = [
            /(?:société|entreprise|company|ets|sarl|sas|sa|eurl|ltd|inc|corp)\s*[:\-]?\s*([A-ZÀ-Ü][\wÀ-ü\s&'.,-]+)/i,
            /(?:fournisseur|vendeur|supplier|from)\s*[:\-]?\s*([A-ZÀ-Ü][\wÀ-ü\s&'.,-]+)/i,
        ];
        for (const pattern of companyPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                result.name = match[1].trim().substring(0, 100);
                break;
            }
        }
        return result;
    }
};
exports.DocumentParserService = DocumentParserService;
exports.DocumentParserService = DocumentParserService = DocumentParserService_1 = __decorate([
    (0, common_1.Injectable)()
], DocumentParserService);
//# sourceMappingURL=document-parser.service.js.map