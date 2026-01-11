import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EmailAttachment, PriceRequestItem, ExtractedPdfData } from '../common/interfaces';

export interface ExtractedDocumentData {
  filename: string;
  type: 'pdf' | 'excel' | 'word' | 'email' | 'image';
  text: string;
  items: PriceRequestItem[];
  tables?: any[][];
  rfqNumber?: string;
  needsVerification?: boolean;      // true si extraction OCR ou incertaine
  extractionMethod?: string;        // 'pdftotext' | 'pdf-parse' | 'ocr' | 'filename' | 'email_body' | 'image_ocr'
  // Métadonnées email
  deadline?: string;
  contactName?: string;
  contactPhone?: string;
  contactRole?: string;
  isUrgent?: boolean;
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  /**
   * Vérifie si une ligne contient des métadonnées d'email à ignorer
   */
  private isEmailMetadata(text: string): boolean {
    const emailPatterns = [
      /^(From|To|Cc|Bcc|Subject|Sent|Date|Re:|Fwd:|De:|À:|Objet:)\s*:/i,
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\w+\s+\d{1,2},?\s+\d{4}/i,
      /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche),?\s+\d{1,2}\s+\w+\s+\d{4}/i,
      /^\s*(From|Sent|Subject|To|Cc)\s+/i,
      /\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, // Heures d'envoi
    ];
    return emailPatterns.some(p => p.test(text));
  }

  /**
   * Vérifie si une ligne contient des informations légales d'entreprise à ignorer
   */
  private isCompanyHeader(text: string): boolean {
    const companyPatterns = [
      /\b(Capital\s+social|RCCM|RC\s*:|NIF|SIRET|SIREN)\b/i,
      /\b(Bon\s+de\s+commande|Purchase\s+Order)\b.*\b(Num[eé]ro|Number|No\.?)\b/i,
      /\bTEL\/FAX\s*:/i,
      /\bBP\s+\d+\s+Abidjan/i,
      /\bC[oô]te\s+d['']?Ivoire\b/i,
      /\bSoci[eé]t[eé]\s+de\s+Mines/i,
      /\bEndeavour\s+Mining\b.*\b(Si[eè]ge|rue|ancien)\b/i,
      /^\s*CIV\s*$/i, // Code pays seul
    ];
    return companyPatterns.some(p => p.test(text));
  }

  /**
   * Vérifie si une quantité est valide (pas un numéro de commande/référence)
   */
  private isValidQuantity(qty: number): boolean {
    // Les quantités > 100000 sont probablement des numéros de commande
    // Les quantités typiques sont entre 1 et 10000
    return qty > 0 && qty <= 100000;
  }

  // Patterns pour extraire le numéro RFQ
  private readonly rfqPatterns = [
    /Purchase\s+Requisitions?\s+No[:\s]*(\d+)/gi,
    /PR[\s\-_]*(\d{6,})/gi,
    /(?:RFQ|RFP|REF|N°|No\.|Référence|Reference|Demande)\s*[:\-#]?\s*([A-Z0-9][\w\-\/]+)/gi,
    /(?:Quotation|Quote|Devis)\s*(?:Request)?\s*[:\-#]?\s*([A-Z0-9][\w\-\/]+)/gi,
    /([A-Z]{2,4}[\-\/]?\d{4,}[\-\/]?\d{0,4})/g,
  ];

  async parseDocument(attachment: EmailAttachment): Promise<ExtractedDocumentData | null> {
    const filename = attachment.filename.toLowerCase();
    
    try {
      if (filename.endsWith('.pdf')) {
        return this.parsePdf(attachment);
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        return this.parseExcel(attachment);
      } else if (filename.endsWith('.docx') || filename.endsWith('.doc')) {
        return this.parseWord(attachment);
      } else if (filename.match(/\.(png|jpg|jpeg|gif|bmp|tiff?)$/)) {
        return this.parseImage(attachment);
      } else {
        this.logger.warn(`Type de fichier non supporté: ${attachment.filename}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Erreur parsing ${attachment.filename}:`, error.message);
      return null;
    }
  }

  async parseAllAttachments(attachments: EmailAttachment[]): Promise<ExtractedDocumentData[]> {
    const results: ExtractedDocumentData[] = [];
    
    for (const attachment of attachments) {
      const parsed = await this.parseDocument(attachment);
      if (parsed) {
        results.push(parsed);
      }
    }
    
    return results;
  }

  /**
   * Parse le corps d'un email pour extraire une demande de prix
   * Utile quand il n'y a pas de pièce jointe PDF/Excel
   */
  parseEmailBody(body: string, subject: string): ExtractedDocumentData {
    // D'abord essayer l'extraction spécifique pour les emails RFQ
    const rfqItems = this.extractItemsFromEmailBody(body);
    
    // Si rien trouvé, utiliser l'extraction de texte générique
    const items = rfqItems.length > 0 ? rfqItems : this.extractItemsFromText(body);
    const rfqNumber = this.extractRfqNumber(subject + ' ' + body);

    // Extraire les métadonnées de l'email
    const metadata = this.extractEmailMetadata(body);

    return {
      filename: 'email_body',
      type: 'email',
      text: body,
      items,
      rfqNumber,
      needsVerification: rfqItems.length > 0, // Les extractions d'email nécessitent vérification
      extractionMethod: 'email_body',
      ...metadata,
    };
  }

  /**
   * Extraction spécifique pour les emails de demande de prix
   */
  private extractItemsFromEmailBody(body: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    const text = body.toLowerCase();
    
    // Pattern 1: "cotation de X unités de ce matériel"
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

    // Extraire le nom du produit/appareil
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
    
    // Extraction directe des termes techniques (appareils de mesure, pièces, etc.)
    const technicalTerms: string[] = [];
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
    
    // Construire la description
    let description = '';
    if (technicalTerms.length > 0) {
      description = [...new Set(technicalTerms)].join(' / ');
    } else if (productName) {
      description = productName.toUpperCase();
    }
    
    // Ajouter le contexte d'utilisation
    const usageMatch = body.match(/(?:qui\s+)?permet(?:tant)?\s+de\s+([^.]+)/i);
    if (usageMatch && description) {
      description += ` (${usageMatch[1].trim()})`;
    }
    
    // Si on a trouvé un produit, créer l'item
    if (description && quantity > 0) {
      const notes: string[] = [];
      
      // Vérifier les demandes additionnelles
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
        needsManualReview: true, // Toujours vérifier les extractions d'email
        isEstimated: false,
      });
    }
    
    return items;
  }

  /**
   * Extraire les métadonnées d'un email (contact, deadline, etc.)
   */
  private extractEmailMetadata(body: string): { 
    deadline?: string; 
    contactName?: string; 
    contactPhone?: string;
    contactRole?: string;
    isUrgent?: boolean;
  } {
    const result: any = {};
    
    // Deadline
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
    
    // Contact - Nom (après "Cordialement" ou signature)
    const nameMatch = body.match(/(?:cordialement|cdlt|regards|salutations)[,.\s]*\n+([A-ZÉÈÀÙÂÊÎÔÛÇ][A-ZÉÈÀÙÂÊÎÔÛÇ\s]+)\n/i);
    if (nameMatch) {
      result.contactName = nameMatch[1].trim();
    }
    
    // Contact - Rôle
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
    
    // Contact - Téléphone
    const phoneMatch = body.match(/(?:CEL|TEL|T[ée]l|Mobile|Phone|GSM)[.\s:]*([0-9\s\-\.+]+)/i);
    if (phoneMatch) {
      result.contactPhone = phoneMatch[1].replace(/\s+/g, ' ').trim();
    }
    
    // Urgence
    result.isUrgent = /urgent/i.test(body);
    
    return result;
  }

  // ============ PDF PARSING ============

  private async parsePdf(attachment: EmailAttachment): Promise<ExtractedDocumentData> {
    let text = '';
    let needsVerification = false;
    let extractionMethod = '';
    
    // Méthode 1: pdftotext (meilleure extraction pour PDFs avec texte numérique)
    try {
      text = await this.extractTextWithPdftotext(attachment.content);
      if (text && text.trim().length >= 50) {
        extractionMethod = 'pdftotext';
        this.logger.debug(`pdftotext extraction: ${text.length} caractères`);
      }
    } catch (error) {
      this.logger.warn(`pdftotext failed: ${error.message}`);
    }
    
    // Méthode 2: pdf-parse comme fallback
    if (!text || text.trim().length < 50) {
      try {
        const pdfParseDefault = (pdfParse as any).default || pdfParse;
        const data = await pdfParseDefault(attachment.content);
        if (data.text && data.text.trim().length > (text?.length || 0)) {
          text = data.text;
          extractionMethod = 'pdf-parse';
          this.logger.debug(`pdf-parse extraction: ${text.length} caractères`);
        }
      } catch (error) {
        this.logger.warn(`pdf-parse failed: ${error.message}`);
      }
    }
    
    // Méthode 3: OCR avec Tesseract pour les documents scannés
    if (!text || text.trim().length < 50) {
      this.logger.log(`Document semble être un scan, tentative OCR: ${attachment.filename}`);
      try {
        text = await this.extractTextWithOcr(attachment.content);
        if (text && text.trim().length > 20) {
          extractionMethod = 'ocr';
          needsVerification = true; // OCR nécessite vérification manuelle
          this.logger.debug(`OCR extraction: ${text.length} caractères`);
        }
      } catch (error) {
        this.logger.warn(`OCR failed: ${error.message}`);
      }
    }
    
    // Si toujours pas de texte, extraire les infos du nom de fichier
    let filenameInfo: { rfqNumber?: string; description?: string; brand?: string } = {};
    if (!text || text.trim().length < 20) {
      filenameInfo = this.extractInfoFromFilename(attachment.filename);
      needsVerification = true;
      this.logger.warn(`Extraction minimale depuis le nom de fichier: ${attachment.filename}`);
    }

    const items = this.extractItemsFromText(text || '');
    let rfqNumber = this.extractRfqNumber(text || '') || filenameInfo.rfqNumber;

    // Si OCR ou extraction minimale, créer un item générique avec les infos du nom de fichier
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

    // Ajouter note de vérification aux items existants si OCR
    if (needsVerification && items.length > 0) {
      items.forEach(item => {
        const verificationNote = '⚠️ VÉRIFICATION REQUISE - Extrait par OCR';
        item.notes = item.notes ? `${item.notes} | ${verificationNote}` : verificationNote;
        // Ajouter la marque du fichier si pas déjà présente
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

  /**
   * Extraire le texte d'un PDF avec pdftotext (poppler-utils)
   */
  private async extractTextWithPdftotext(buffer: Buffer): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`);
    
    try {
      fs.writeFileSync(tempFile, buffer);
      
      const result = execSync(`pdftotext -layout "${tempFile}" -`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      
      return result;
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        this.logger.warn(`Erreur suppression fichier temp: ${e.message}`);
      }
    }
  }

  /**
   * Extraire le texte d'un PDF scanné avec OCR (Tesseract)
   * Prérequis: tesseract-ocr, tesseract-ocr-fra, poppler-utils, imagemagick
   */
  private async extractTextWithOcr(buffer: Buffer): Promise<string> {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const tempPdf = path.join(tempDir, `ocr_${timestamp}.pdf`);
    const tempImg = path.join(tempDir, `ocr_${timestamp}.png`);
    const tempImgRotated = path.join(tempDir, `ocr_${timestamp}_rotated.png`);
    
    try {
      // Sauvegarder le PDF
      fs.writeFileSync(tempPdf, buffer);
      
      // Convertir PDF en image haute résolution
      try {
        execSync(`pdftoppm -png -r 300 -singlefile "${tempPdf}" "${tempDir}/ocr_${timestamp}"`, {
          timeout: 60000,
        });
      } catch (e) {
        this.logger.warn(`pdftoppm failed: ${e.message}`);
        return '';
      }
      
      if (!fs.existsSync(tempImg)) {
        this.logger.warn('Image conversion failed - no output file');
        return '';
      }
      
      // Essayer différentes rotations pour trouver la meilleure
      let bestResult = '';
      let bestScore = 0;
      const rotations = [0, 90, 270, 180]; // Ordre de priorité
      
      for (const rotation of rotations) {
        let imgToUse = tempImg;
        
        if (rotation > 0) {
          try {
            execSync(`convert "${tempImg}" -rotate ${rotation} "${tempImgRotated}"`, { timeout: 30000 });
            imgToUse = tempImgRotated;
          } catch (e) {
            continue;
          }
        }
        
        try {
          const result = execSync(`tesseract "${imgToUse}" stdout -l fra+eng --psm 6 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
          });
          
          // Compter les mots lisibles (indicateur de qualité)
          const words = result.match(/[a-zA-ZÀ-ÿ]{3,}/g) || [];
          const score = words.length;
          
          if (score > bestScore) {
            bestScore = score;
            bestResult = result;
            this.logger.debug(`OCR rotation ${rotation}°: ${score} mots détectés`);
          }
          
          // Si on a un bon résultat (>50 mots), on peut arrêter
          if (score > 50) break;
          
        } catch (e) {
          // Tesseract peut échouer silencieusement
        }
      }
      
      return bestResult || '';
      
    } finally {
      // Nettoyer les fichiers temporaires
      [tempPdf, tempImg, tempImgRotated].forEach(f => {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
      });
    }
  }

  /**
   * Extraire les informations utiles du nom de fichier
   * Ex: "BI_19716_ACHAT_DE_FILTRES_CHARGEUSES_KOMATSU_WA470___WA500.pdf"
   */
  private extractInfoFromFilename(filename: string): { rfqNumber?: string; description?: string; brand?: string } {
    const result: { rfqNumber?: string; description?: string; brand?: string } = {};
    
    // Enlever l'extension
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    
    // Patterns pour numéro de référence
    const refPatterns = [
      /\b(BI)[_\-]?(\d{4,})/i,           // BI_19716
      /\b(PR)[_\-]?(\d{4,})/i,           // PR-12345
      /\b(RFQ|REF)[_\-]?(\d{4,})/i,      // RFQ-1234
      /[_\-](\d{5,})[_\-]/,              // _12345_
    ];
    
    for (const pattern of refPatterns) {
      const match = nameWithoutExt.match(pattern);
      if (match) {
        if (match[2]) {
          result.rfqNumber = `${match[1].toUpperCase()}-${match[2]}`;
        } else if (match[1]) {
          result.rfqNumber = match[1];
        }
        break;
      }
    }
    
    // Nettoyer le nom pour créer une description
    let description = nameWithoutExt
      .replace(/^(BI|PR|RFQ|REF)[_\-]?\d+[_\-]?/i, '') // Enlever le préfixe de référence
      .replace(/_+/g, ' ')                              // Underscores -> espaces
      .replace(/\s+/g, ' ')                             // Espaces multiples
      .trim();
    
    // Extraire la marque (équipement)
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

  // ============ EXCEL PARSING ============

  private async parseExcel(attachment: EmailAttachment): Promise<ExtractedDocumentData> {
    const workbook = XLSX.read(attachment.content, { type: 'buffer' });
    
    let allText = '';
    const allItems: PriceRequestItem[] = [];
    const tables: any[][] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      
      // Convertir en JSON pour analyser
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      tables.push(jsonData);

      // Extraire le texte
      const textData = XLSX.utils.sheet_to_txt(sheet);
      allText += textData + '\n';

      // Extraire les items du tableau
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

  private extractItemsFromExcelSheet(data: any[][]): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    if (data.length < 2) return items;

    // Helper pour convertir en string de manière sécurisée
    const safeString = (val: any): string => {
      if (val === null || val === undefined) return '';
      return String(val);
    };
    const safeLower = (val: any): string => safeString(val).toLowerCase();

    // Helper pour trouver l'index de colonne avec exclusions
    const findColumnIndex = (rowLower: string[], patterns: string[], excludePatterns: string[] = []): number => {
      for (let i = 0; i < rowLower.length; i++) {
        const cell = rowLower[i] || '';
        // Vérifier les exclusions
        let excluded = false;
        for (const excl of excludePatterns) {
          if (cell.includes(excl)) { excluded = true; break; }
        }
        if (excluded) continue;
        for (const pattern of patterns) {
          if (cell.includes(pattern)) return i;
        }
      }
      return -1;
    };

    // Trouver la ligne d'en-tête (chercher dans les 20 premières lignes)
    let headerRowIndex = -1;
    let headers: { [key: string]: number } = {};

    for (let i = 0; i < Math.min(20, data.length); i++) {
      const row = data[i];
      if (!row || !Array.isArray(row)) continue;

      const rowLower: string[] = [];
      for (let j = 0; j < row.length; j++) {
        rowLower.push(safeLower(row[j]));
      }
      
      // Chercher DESIGNATION/DESCRIPTION (exclure "code article")
      const descIndex = findColumnIndex(rowLower, 
        ['désignation', 'designation', 'description', 'libellé', 'libelle', 'article', 'item', 'produit'], 
        ['code']
      );
      
      // Chercher la quantité (patterns étendus)
      const qtyIndex = findColumnIndex(rowLower, 
        ['qte', 'qty', 'quantité', 'quantity', 'qté', 'sum of qty', 'total qty', 'demandées', 'commander']
      );
      
      // Chercher la référence/code (priorité à "code article")
      const refIndex = findColumnIndex(rowLower, 
        ['code article', 'code', 'réf', 'référence', 'reference', 'part number', 'part']
      );
      
      // Chercher colonne diamètre/dimension (pour piping)
      const diameterIndex = findColumnIndex(rowLower,
        ['diameter', 'diamètre', 'nominal', 'size', 'dimension']
      );
      
      // Chercher l'unité
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
      // Pas d'en-tête trouvé, essayer d'extraire quand même
      return this.extractItemsFromText(data.map(row => row?.join(' ') || '').join('\n'));
    }

    // Extraire les items avec gestion des descriptions continues
    let lastDescription = '';
    
    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !Array.isArray(row)) continue;
      
      // Vérifier si la ligne a du contenu
      const hasContent = row.some(cell => cell !== null && cell !== undefined && safeString(cell).trim() !== '');
      if (!hasContent) continue;

      // Extraire la description
      let description = '';
      if (headers.description !== -1 && headers.description < row.length) {
        description = safeString(row[headers.description]).trim();
      }
      
      // Si pas de colonne description, chercher une colonne texte longue
      if (!description) {
        for (let j = 0; j < row.length; j++) {
          if (j === headers.reference || j === headers.quantity || j === headers.unit) continue;
          const val = safeString(row[j]).trim();
          if (val.length > 10 && !/^\d+([.,]\d+)?$/.test(val)) {
            description = val;
            break;
          }
        }
      }
      
      // Si description vide mais quantité présente, utiliser la dernière description
      if (!description.trim() && lastDescription) {
        description = lastDescription;
      } else if (description.trim()) {
        lastDescription = description.trim();
      }
      
      // Ignorer les lignes totaux, signatures, etc.
      const descLower = description.toLowerCase();
      if (descLower.includes('grand total') || descLower === 'total' ||
          descLower.includes('sous-total') || descLower.includes('subtotal') ||
          descLower.includes('responsable') || descLower.includes('directeur') ||
          descLower.includes('visa') || descLower.includes('magasin pdr') ||
          descLower.includes('forces speciales') || descLower.includes('entretien')) {
        continue;
      }
      
      if (!description || description.length < 3) continue;

      // Combiner avec le diamètre si présent
      let fullDescription = description.trim();
      if (headers.diameter !== -1 && headers.diameter < row.length && row[headers.diameter]) {
        const diameter = safeString(row[headers.diameter]).trim();
        if (diameter && diameter !== '0' && diameter !== '0 mm') {
          fullDescription = `${fullDescription} - ${diameter}`;
        }
      }

      // Extraire la quantité
      let quantity = 0;
      if (headers.quantity !== -1 && headers.quantity < row.length) {
        quantity = this.parseQuantity(row[headers.quantity]);
      }
      
      // Si quantité = 0, chercher un nombre positif dans la ligne
      if (quantity <= 0) {
        for (let j = 0; j < row.length; j++) {
          if (j === headers.description || j === headers.reference) continue;
          const val = this.parseQuantity(row[j]);
          if (val > 0 && val < 100000) {
            quantity = val;
            break;
          }
        }
      }
      
      // Ignorer les lignes sans quantité valide
      if (quantity <= 0) continue;

      // Extraire l'unité
      let unit = 'pcs';
      if (headers.unit !== -1 && headers.unit < row.length) {
        const unitVal = safeLower(row[headers.unit]).trim();
        if (unitVal && unitVal.length < 10) {
          unit = (unitVal === 'pce' || unitVal === 'pc' || unitVal === 'off' || unitVal === 'ea' || unitVal === 'each') ? 'pcs' : unitVal;
        }
      }
      // Détecter unité dans la quantité (ex: "25 M")
      const qtyStr = headers.quantity !== -1 && headers.quantity < row.length ? safeString(row[headers.quantity]) : '';
      if (qtyStr.toUpperCase().includes(' M')) {
        unit = 'm';
      }

      const item: PriceRequestItem = {
        description: fullDescription,
        quantity: quantity,
        unit: unit,
      };

      // Extraire la référence
      if (headers.reference !== -1 && headers.reference < row.length) {
        const ref = safeString(row[headers.reference]).trim();
        if (ref && ref.length > 2 && !/^\d{1,2}$/.test(ref)) { // Exclure les numéros d'ordre simples (1, 2, 3...)
          item.reference = ref;
          item.supplierCode = ref;
        }
      }

      // Extraire la marque depuis la description
      item.brand = this.extractBrandFromDesc(fullDescription);

      items.push(item);
    }

    this.logger.debug(`${items.length} items extraits du fichier Excel`);
    return items;
  }

  // ============ WORD PARSING ============

  private async parseWord(attachment: EmailAttachment): Promise<ExtractedDocumentData> {
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

  // ============ IMAGE PARSING ============

  /**
   * Vérifie si une image est une image de signature/Outlook à ignorer
   */
  private isSignatureImage(filename: string, size?: number): boolean {
    const lowerName = filename.toLowerCase();

    // Pattern: Images contenant "outlook" n'importe où
    if (/outlook/i.test(lowerName)) return true;

    // Pattern: Images génériques inline (image001.png, image002.jpg)
    if (/^image\d+\./i.test(lowerName)) return true;

    // Pattern: Images contenant "logo"
    if (/logo/i.test(lowerName)) return true;

    // Pattern: Images de signature courantes
    if (/^(signature|footer|banner|header)/i.test(lowerName)) return true;

    // Pattern: Images inline Microsoft (ATT00001.png)
    if (/^att\d+\./i.test(lowerName)) return true;

    // Pattern: Fichiers se terminant par "Desc.png/jpg"
    if (/desc\.(png|jpg|jpeg|gif)$/i.test(lowerName)) return true;

    // Pattern: CID references
    if (/^cid[:\-_]/i.test(lowerName)) return true;

    // Pattern: Images avec ID hexadécimaux
    if (/^[a-f0-9]{8,}[-_]/i.test(lowerName)) return true;

    // Très petites images (< 10KB) sont probablement des icônes/spacers
    if (size && size < 10000) return true;

    return false;
  }

  /**
   * Parse une image (plaque signalétique, photo de pièce, etc.)
   * Utilise OCR pour extraire le texte et identifie les informations clés
   */
  private async parseImage(attachment: EmailAttachment): Promise<ExtractedDocumentData> {
    // Filtrer les images de signature/Outlook AVANT tout traitement
    if (this.isSignatureImage(attachment.filename, attachment.size)) {
      this.logger.debug(`Image de signature ignorée: ${attachment.filename}`);
      return {
        filename: attachment.filename,
        type: 'image' as any,
        text: '',
        items: [],
        needsVerification: false,
        extractionMethod: 'skipped_signature',
      };
    }

    let text = '';
    let extractionMethod = 'image_ocr';
    const items: PriceRequestItem[] = [];

    // Sauvegarder l'image temporairement pour OCR
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `img_${Date.now()}_${attachment.filename}`);
    
    try {
      fs.writeFileSync(tmpPath, attachment.content);
      
      // Essayer OCR avec Tesseract
      try {
        text = execSync(`tesseract "${tmpPath}" stdout -l eng+fra 2>/dev/null`, {
          timeout: 30000,
        }).toString();
        this.logger.debug(`OCR image: ${text.length} caractères extraits`);
      } catch (ocrError) {
        this.logger.warn(`OCR image failed: ${ocrError.message}`);
      }
      
      // Extraire les informations de plaque signalétique
      const nameplateInfo = this.extractNameplateInfo(text, attachment.filename);
      
      if (nameplateInfo.partNumber || nameplateInfo.model) {
        // Créer un item basé sur les informations de la plaque
        const descParts: string[] = [];
        
        if (nameplateInfo.brand) {
          descParts.push(nameplateInfo.brand);
        }
        if (nameplateInfo.description) {
          descParts.push(nameplateInfo.description);
        }
        
        const item: PriceRequestItem = {
          description: descParts.join(' - ') || `Pièce détachée (voir image: ${attachment.filename})`,
          quantity: 1,
          unit: 'pcs',
          supplierCode: nameplateInfo.partNumber,
          brand: nameplateInfo.brand,
          needsManualReview: true, // Toujours vérifier les OCR d'images
          isEstimated: false,
          originalLine: 0,
        };
        
        // Ajouter les détails en notes
        const notes: string[] = [];
        if (nameplateInfo.model) notes.push(`Model: ${nameplateInfo.model}`);
        if (nameplateInfo.serial) notes.push(`S/N: ${nameplateInfo.serial}`);
        if (nameplateInfo.equipment) notes.push(`Équipement: ${nameplateInfo.equipment}`);
        if (notes.length > 0) {
          item.notes = notes.join(' | ');
        }
        
        items.push(item);
      } else {
        // Pas d'info extraite, créer un item générique
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
      
    } finally {
      // Nettoyer le fichier temporaire
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch (e) {
        // Ignorer les erreurs de nettoyage
      }
    }
    
    return {
      filename: attachment.filename,
      type: 'image' as any,
      text: text || '',
      items,
      needsVerification: true,
      extractionMethod,
    };
  }

  /**
   * Extraire les informations d'une plaque signalétique
   */
  private extractNameplateInfo(ocrText: string, filename: string): {
    partNumber?: string;
    model?: string;
    serial?: string;
    brand?: string;
    description?: string;
    equipment?: string;
  } {
    const result: any = {};
    const text = ocrText.toUpperCase();
    const fileUpper = filename.toUpperCase();
    
    // Extraire le Part Number (formats courants)
    const pnPatterns = [
      /P\/N[:\s]*([A-Z0-9\-\/\s]+)/i,
      /PART\s*(?:NO|NUMBER|#)?[:\s]*([A-Z0-9\-\/\s]+)/i,
      /(\d{3}\s*\d{4})/,  // Format 710 0321
      /REF[:\s]*([A-Z0-9\-\/]+)/i,
    ];
    for (const pattern of pnPatterns) {
      const match = text.match(pattern);
      if (match) {
        result.partNumber = match[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }
    
    // Extraire le Model
    const modelMatch = text.match(/MODEL[:\s]*([A-Z0-9\.\-\/]+)/i);
    if (modelMatch) {
      result.model = modelMatch[1].trim();
    }
    
    // Extraire le Serial
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
    
    // Détecter la marque (depuis le texte OCR ou le nom de fichier)
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
    
    // Si SPICER trouvé, compléter avec DANA SPICER
    if (text.includes('SPICER') || text.includes('DANA')) {
      result.brand = 'DANA SPICER';
      result.description = 'OFF-HIGHWAY COMPONENT';
    }
    
    // Extraire l'équipement depuis le nom de fichier
    const equipmentFromFile = fileUpper.replace(/\.(PNG|JPG|JPEG|GIF|BMP|TIFF?)$/i, '');
    if (equipmentFromFile && equipmentFromFile !== result.brand) {
      result.equipment = equipmentFromFile;
    }
    
    return result;
  }

  // ============ TEXT EXTRACTION ============

  extractItemsFromText(text: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    // Normaliser le texte pour la détection (insensible à la casse)
    const textLower = text.toLowerCase();

    // Détecter le format Purchase Requisition (Endeavour Mining)
    // Amélioration: détection insensible à la casse
    const isPurchaseRequisition = 
      textLower.includes('purchase requisition') || 
      textLower.includes('item code') || 
      textLower.includes('item description') ||
      text.match(/\b\d{1,2}\s+\d+\s+EA\s+\d{5,6}\s+[A-Z]/i); // Pattern direct
    
    if (isPurchaseRequisition) {
      this.logger.log('Format Purchase Requisition détecté, extraction spécifique...');
      const prItems = this.extractPurchaseRequisitionItems(text);
      this.logger.log(`Extraction PR: ${prItems.length} items trouvés`);
      if (prItems.length > 0) {
        return prItems;
      }
    }

    const patterns = [
      // Pattern: Référence - Description - Quantité - Unité
      /^([A-Z0-9][\w\-]+)\s*[-–:]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?|kg|m|l|pièces?|ea|each)?/i,
      // Pattern: Quantité x Description
      /^(\d+(?:[.,]\d+)?)\s*[xX×]\s*(.{10,})/,
      // Pattern: Description : Quantité unité
      /^(.{10,}?)\s*:\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?|kg|m|l|pièces?|ea|each)?/i,
      // Pattern numéro de ligne: 1. Description - Qté
      /^\d+[.\)]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)\s*(pcs?|unités?)?/i,
      // Pattern avec tiret au début
      /^[-•]\s*(.{10,}?)\s*[-–:]\s*(\d+(?:[.,]\d+)?)/,
    ];

    const seenDescriptions = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10 || trimmed.length > 500) continue;

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

    return items.slice(0, 100); // Limiter à 100 items
  }

  private extractPurchaseRequisitionItems(text: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];

    this.logger.debug('=== Début extraction Purchase Requisition ===');

    // Nettoyer le texte
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n');

    // =====================================================
    // MÉTHODE PRIORITAIRE: Extraction par numéro de ligne (10, 20, 30...)
    // Format: "10 3 EA 710 0321 TRANSMISSION ASSY" ou similaire
    // =====================================================

    const lineBasedItems = this.extractItemsByLineNumber(cleanText);
    if (lineBasedItems.length > 0) {
      this.logger.log(`Méthode ligne numérotée: ${lineBasedItems.length} items extraits`);
      return lineBasedItems;
    }
    
    // =====================================================
    // MÉTHODE 0: Recherche directe du pattern dans tout le texte (NOUVELLE)
    // Format: Line Qty UOM ItemCode Description... GLCode Cost Cost
    // Exemple: "10 10 EA 201368 RELAY OVERLOAD... 1500405 0 0"
    // =====================================================
    
    this.logger.debug('Essai méthode 0: Pattern direct global');
    
    // Pattern global pour trouver toutes les lignes d'items
    const globalPattern = /\b(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s+1500\d+|\s+\d+\s+\d+\s*(USD|EUR|XOF)?|\s*$)/gi;
    
    let globalMatch;
    const foundItems: Map<string, { qty: number; unit: string; desc: string; lineNum: string }> = new Map();
    
    while ((globalMatch = globalPattern.exec(cleanText)) !== null) {
      const lineNum = globalMatch[1];
      const qty = parseInt(globalMatch[2], 10);
      const unit = globalMatch[3];
      const itemCode = globalMatch[4];
      let description = globalMatch[5].trim();

      // Nettoyer la description
      description = description.replace(/\s+1500\d+.*$/i, '').trim();
      description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
      description = description.replace(/\s+0\s+0\s*$/i, '').trim();
      description = description.replace(/\s{2,}/g, ' ').trim();

      // FILTRE: Ignorer les métadonnées d'email et en-têtes d'entreprise
      if (this.isEmailMetadata(description) || this.isCompanyHeader(description)) {
        this.logger.debug(`Item ignoré (metadata/header): "${description.substring(0, 50)}..."`);
        continue;
      }

      // FILTRE: Vérifier que la quantité est valide
      if (!this.isValidQuantity(qty)) {
        this.logger.debug(`Item ignoré (qty invalide ${qty}): "${description.substring(0, 50)}..."`);
        continue;
      }

      if (description.length > 5 && !foundItems.has(itemCode)) {
        foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
        this.logger.debug(`Méthode 0 - Item trouvé: Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
      }
    }
    
    // Si on a trouvé des items avec la méthode 0, les enrichir avec les lignes de continuation
    if (foundItems.size > 0) {
      for (const [itemCode, data] of foundItems) {
        // Chercher les lignes de continuation après l'item
        const itemIndex = cleanText.indexOf(itemCode);
        if (itemIndex > -1) {
          const afterItem = cleanText.substring(itemIndex);
          const continuationLines: string[] = [];
          const afterLines = afterItem.split('\n').slice(1);
          
          for (const contLine of afterLines) {
            const trimmed = contLine.trim();
            // Arrêter sur marqueurs de fin
            if (!trimmed || 
                trimmed.match(/^(Additional|Total|Page|\d{1,3}\s+\d+\s+(EA|PCS))/i)) {
              break;
            }
            // Ignorer les headers et devises
            if (trimmed.match(/^(Line|Quantity|UOM|Item|Sub|Activity|GL|Code|Cost|USD|EUR|XOF)/i)) {
              continue;
            }
            // Ajouter si commence par une lettre
            if (trimmed.match(/^[A-Z]/i) && trimmed.length > 3) {
              let addText = trimmed.replace(/\s+(USD|EUR|XOF).*$/i, '').trim();
              addText = addText.replace(/\s+\d+\s*$/i, '').trim();
              if (addText.length > 3) {
                continuationLines.push(addText);
              }
            }
          }
          
          // Construire la description complète
          let fullDesc = data.desc;
          for (const cont of continuationLines) {
            if (!fullDesc.toLowerCase().includes(cont.toLowerCase().substring(0, 15))) {
              fullDesc += ' ' + cont;
            }
          }
          
          // Nettoyer les répétitions (format "DESC - DESC")
          const parts = fullDesc.split(' - ');
          if (parts.length === 2 && parts[0].toLowerCase().substring(0, 20) === parts[1].toLowerCase().substring(0, 20)) {
            fullDesc = parts[0].trim();
          }
          
          // Extraire code fournisseur et marque
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
    
    // =====================================================
    // MÉTHODE 1: Format avec Part Number séparé (PR-719)
    // Format tableau: Line | Qty | UOM | Item Code | Part Number | Item Description
    // =====================================================
    
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
    
    // =====================================================
    // MÉTHODE 2: Extraction ligne par ligne avec continuation
    // Pour gérer le format pdftotext -layout qui split sur plusieurs lignes
    // =====================================================
    
    if (items.length === 0) {
      this.logger.debug('Essai extraction multi-ligne (pdftotext layout)');
      
      interface TempItem {
        internalCode: string;
        description: string;
        quantity: number;
        unit: string;
        additionalLines: string[];
      }
      
      let currentItem: TempItem | null = null;
      let collectingDescription = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Pattern principal: "10       1        EA    144850        FAN AXIAL..."
        const mainLineMatch = line.match(/^\s*(\d{1,2})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT)\s+(\d{5,6})\s+(.+)/i);
        
        if (mainLineMatch) {
          // Sauvegarder l'item précédent
          if (currentItem) {
            const finalItem = this.finalizeMultilineItem(currentItem);
            if (finalItem) items.push(finalItem);
          }
          
          const qty = parseInt(mainLineMatch[2], 10);
          const unit = mainLineMatch[3];
          const itemCode = mainLineMatch[4];
          let description = mainLineMatch[5].trim();
          
          // Nettoyer: enlever colonnes GL Code, Cost
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
        
        // Collecter les lignes de continuation
        if (collectingDescription && currentItem) {
          // Arrêter la collecte sur certains marqueurs
          if (trimmed.startsWith('Additional Description') || 
              trimmed.startsWith('Total in USD') ||
              trimmed.startsWith('Page ')) {
            collectingDescription = false;
            continue;
          }
          
          if (trimmed === '') continue;
          if (trimmed.match(/^(Line|Quantity|UOM|Item|Sub|Activity|GL|Code|Cost)/i)) continue;
          if (trimmed.match(/^(USD|EUR|XOF|\d+\s*(USD|EUR|XOF))$/i)) continue;
          
          // Garder le texte utile
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
      
      // Ne pas oublier le dernier item
      if (currentItem) {
        const finalItem = this.finalizeMultilineItem(currentItem);
        if (finalItem) items.push(finalItem);
      }
    }
    
    // =====================================================
    // MÉTHODE 3: Fallback avec regex simple si toujours rien
    // =====================================================
    
    if (items.length === 0) {
      this.logger.debug('Essai extraction par Item Code direct');
      
      for (const line of lines) {
        const codeMatch = line.match(/\b(\d{5,6})\s+([A-Z][A-Z0-9\s\-\.\/\&\,]+)/i);
        
        if (codeMatch) {
          const itemCode = codeMatch[1];
          let description = codeMatch[2].trim();
          
          if (itemCode.startsWith('1500')) continue;
          if (description.match(/^(USD|EUR|XOF|Total|Cost|Max)/i)) continue;
          
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
    
    // =====================================================
    // MÉTHODE 4: Enrichir depuis Additional Description (multi-ligne)
    // =====================================================
    
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

  /**
   * Extraire le contenu de Additional Description (peut être sur plusieurs lignes)
   */
  private extractAdditionalDescription(text: string): string {
    const lines = text.split('\n');
    let foundAdditional = false;
    const additionalContent: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Détecter "Additional Description"
      if (trimmed.match(/^Additional\s*(Description)?/i)) {
        foundAdditional = true;
        // Vérifier si le contenu est sur la même ligne
        const sameLine = trimmed.replace(/^Additional\s*(Description)?[:\s]*/i, '').trim();
        if (sameLine.length > 5 && !sameLine.match(/^HOD/i)) {
          additionalContent.push(sameLine);
        }
        continue;
      }
      
      // Collecter les lignes suivantes (jusqu'au tableau des lignes)
      if (foundAdditional) {
        // Arrêter si on atteint le tableau ou la fin
        if (trimmed.match(/^\s*Line\s+Quantity/i) || 
            trimmed.match(/^\s*\d{1,2}\s+\d+\s+(EA|PCS)/i) ||
            trimmed.match(/^Total\s+in/i)) {
          break;
        }
        
        // Ignorer les en-têtes
        if (trimmed.match(/^(HOD|signature|name\s*&)/i)) continue;
        if (trimmed === '') continue;
        
        // Garder le contenu utile
        let content = trimmed.replace(/\s+HOD\s+name.*$/i, '').trim();
        content = content.replace(/\s+signature.*$/i, '').trim();
        
        if (content.length > 3) {
          additionalContent.push(content);
        }
      }
    }
    
    return additionalContent.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Finaliser un item multi-ligne extrait de pdftotext
   */
  private finalizeMultilineItem(item: { 
    internalCode: string; 
    description: string; 
    quantity: number; 
    unit: string; 
    additionalLines: string[] 
  }): PriceRequestItem | null {
    let fullDescription = item.description;
    
    // Ajouter les lignes additionnelles sans répétition
    for (const addLine of item.additionalLines) {
      if (!fullDescription.toLowerCase().includes(addLine.toLowerCase().substring(0, 10))) {
        fullDescription += ' ' + addLine;
      }
    }
    
    // Nettoyer la description finale
    fullDescription = this.cleanPRDescription(fullDescription);
    
    if (fullDescription.length < 5) return null;
    
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

  /**
   * Nettoyer une description de Purchase Requisition
   */
  private cleanPRDescription(desc: string): string {
    // Supprimer les devises et prix orphelins
    desc = desc.replace(/\s+(USD|EUR|XOF)\s*/gi, ' ');
    desc = desc.replace(/\s+\d+\s+(USD|EUR|XOF)/gi, '');
    
    // Supprimer les espaces multiples
    desc = desc.replace(/\s{2,}/g, ' ');
    
    // Supprimer les répétitions (si le même texte apparaît après un tiret)
    const parts = desc.split(' - ');
    if (parts.length === 2) {
      const firstPart = parts[0].trim();
      const secondPart = parts[1].trim();
      
      if (secondPart.toLowerCase().startsWith(firstPart.substring(0, 15).toLowerCase())) {
        desc = firstPart;
      }
    }
    
    // Supprimer les zéros orphelins
    desc = desc.replace(/\s+0+\s*$/g, '');
    
    return desc.trim();
  }

  /**
   * Extraire le code fournisseur depuis la description
   */
  private extractSupplierCodeFromDesc(description: string): string | undefined {
    // Patterns de codes fournisseurs
    const patterns = [
      /\b([A-Z]{2,}[\-][A-Z0-9\-]+)\b/i,        // HTM-56-4T, SKF-6205
      /\b([A-Z]{2,}\d+[A-Z0-9]*\/[A-Z0-9]+)\b/i, // AL105NXDC024R/R
      /\b(\d{3,}\s+\d{3,})\b/,                    // 710 0321
      /\b([A-Z]{2,}\d{3,}[A-Z0-9\-]*)\b/i,       // SKF6205, HTM564T
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1].length >= 5) {
        const code = match[1];
        // Exclure les mots communs
        if (!/^(USD|EUR|PCS|UNIT|TOTAL)$/i.test(code)) {
          return code;
        }
      }
    }

    return undefined;
  }

  /**
   * Extraire la marque depuis la description
   */
  private extractBrandFromDesc(description: string): string | undefined {
    const knownBrands = [
      // Équipement lourd
      'TEREX', 'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI', 'VOLVO', 'LIEBHERR',
      'SANDVIK', 'EPIROC', 'METSO', 'ATLAS COPCO', 'JOHN DEERE', 'BELL',
      // Roulements
      'SKF', 'FAG', 'NSK', 'NTN', 'TIMKEN', 'INA', 'KOYO',
      // Électrique
      'SIEMENS', 'ABB', 'SCHNEIDER', 'ALLEN BRADLEY', 'ROCKWELL', 'OMRON',
      // Hydraulique
      'PARKER', 'REXROTH', 'BOSCH', 'FESTO', 'SMC', 'EATON', 'VICKERS',
      // Transmission
      'DANA', 'CARRARO', 'ZF', 'CLARK', 'ALLISON',
      // Autres
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

  private parseMatchedItem(match: RegExpMatchArray, pattern: RegExp): PriceRequestItem | null {
    const patternStr = pattern.source;

    // Pattern: Référence - Description - Quantité
    if (patternStr.includes('A-Z0-9') && patternStr.includes('[-–:]')) {
      return {
        reference: match[1]?.trim(),
        description: match[2]?.trim(),
        quantity: this.parseQuantity(match[3]),
        unit: match[4]?.trim(),
      };
    }

    // Pattern: Quantité x Description
    if (patternStr.includes('[xX×]')) {
      return {
        description: match[2]?.trim(),
        quantity: this.parseQuantity(match[1]),
      };
    }

    // Pattern: Description : Quantité
    if (patternStr.includes('\\s*:\\s*')) {
      return {
        description: match[1]?.trim(),
        quantity: this.parseQuantity(match[2]),
        unit: match[3]?.trim(),
      };
    }

    // Patterns avec numérotation ou tirets
    if (patternStr.includes('\\d+[.\\)]') || patternStr.includes('[-•]')) {
      return {
        description: match[1]?.trim(),
        quantity: this.parseQuantity(match[2]),
        unit: match[3]?.trim(),
      };
    }

    return null;
  }

  private parseQuantity(value: any): number {
    if (!value) return 1;
    const num = parseFloat(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
    return isNaN(num) || num <= 0 ? 1 : num;
  }

  // ============ RFQ NUMBER EXTRACTION ============

  extractRfqNumber(text: string): string | undefined {
    for (const pattern of this.rfqPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const candidate = match[1];
        // Valider le format (au moins 4 caractères, contient des chiffres)
        if (candidate && candidate.length >= 4 && /\d/.test(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  // ============ SUPPLIER INFO EXTRACTION ============

  extractSupplierInfo(text: string): { name?: string; email?: string; phone?: string } {
    const result: { name?: string; email?: string; phone?: string } = {};

    // Email
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
    if (emailMatch) {
      result.email = emailMatch[0];
    }

    // Téléphone
    const phoneMatch = text.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 8) {
      result.phone = phoneMatch[0];
    }

    // Nom de société
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

  // ============ NOUVEAU PARSER PAR NUMÉRO DE LIGNE ============

  /**
   * Extraction basée sur les lignes numérotées (10, 20, 30...)
   * Les tableaux dans les PDFs Purchase Requisition utilisent ce format
   */
  private extractItemsByLineNumber(fullText: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    const normalized = fullText.replace(/\r/g, '');

    // Extraire les lignes candidates (commencent par un numéro de ligne)
    const candidates = normalized
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => /^\d{1,3}\s+/.test(s));

    this.logger.debug(`Lignes candidates trouvées: ${candidates.length}`);

    for (const raw of candidates) {
      const parsed = this.parseLineRow(raw);
      if (parsed) {
        // Enrichir avec marque et code fournisseur
        parsed.brand = this.extractBrandFromDesc(parsed.description || '');
        parsed.supplierCode = this.extractSupplierCodeFromDesc(parsed.description || '');

        // Nettoyer la description
        if (parsed.description) {
          parsed.description = this.cleanPRDescription(parsed.description);
        }

        items.push(parsed);
        this.logger.debug(
          `Item ligne ${parsed.originalLine}: Qty=${parsed.quantity}, Desc="${(parsed.description || '').substring(0, 50)}..."`,
        );
      }
    }

    return items;
  }

  /**
   * Parser une ligne de tableau PR
   * Heuristique multi-modèles pour supporter différents formats
   */
  private parseLineRow(raw: string): PriceRequestItem | null {
    const parts = raw.trim().split(/\s+/);

    // Numéro de ligne (10, 20, 30...)
    const lineNo = Number(parts[0]);
    if (!Number.isFinite(lineNo) || lineNo < 1 || lineNo > 999) return null;

    // Quantité (deuxième élément)
    const qty = Number(parts[1]);
    const qtyVal = Number.isFinite(qty) && qty > 0 && qty <= 100000 ? qty : null;

    // Si pas de quantité valide, ignorer cette ligne
    if (!qtyVal) return null;

    // UOM (troisième élément)
    const uom = parts[2] ?? null;
    const validUoms = ['EA', 'PCS', 'PC', 'KG', 'M', 'L', 'SET', 'UNIT', 'LOT', 'OFF', 'EACH'];
    const isValidUom = uom && validUoms.includes(uom.toUpperCase());

    let idx = isValidUom ? 3 : 2;

    // Item Code (code numérique 5-6 chiffres)
    let itemCode: string | null = null;
    if (parts[idx] && /^\d{5,8}$/.test(parts[idx])) {
      itemCode = parts[idx];
      idx++;
    }

    // Part Number (peut contenir des tirets, espaces, slashes)
    let partNumber: string | null = null;

    // Cas spécial: Part Number en deux parties (ex: "710 0321")
    if (
      parts[idx] &&
      parts[idx + 1] &&
      /^\d{3}$/.test(parts[idx]) &&
      /^\d{4}$/.test(parts[idx + 1])
    ) {
      partNumber = `${parts[idx]} ${parts[idx + 1]}`;
      idx += 2;
    }
    // Part Number standard avec tiret/slash
    else if (parts[idx] && /[-\/]/.test(parts[idx])) {
      partNumber = parts[idx];
      idx++;
    }
    // Part Number alphanumérique (ex: KI38822-0004-1)
    else if (parts[idx] && /^[A-Z]{1,3}\d+/i.test(parts[idx])) {
      partNumber = parts[idx];
      idx++;
    }

    // Le reste est la description
    let description = parts.slice(idx).join(' ').trim();

    // Nettoyer la description (enlever codes GL, prix, etc.)
    description = description.replace(/\s+1500\d+.*$/i, '').trim();
    description = description.replace(/\s+\d+\s+(USD|EUR|XOF).*$/i, '').trim();
    description = description.replace(/\s+0\s+0\s*$/i, '').trim();
    description = description.replace(/\s{2,}/g, ' ').trim();

    // Validation: description doit avoir au moins 5 caractères
    if (!description || description.length < 5) return null;

    // Ignorer les lignes qui sont des en-têtes ou totaux
    const descLower = description.toLowerCase();
    if (
      descLower.includes('total') ||
      descLower.includes('grand total') ||
      descLower.startsWith('line') ||
      descLower.startsWith('quantity')
    ) {
      return null;
    }

    return {
      originalLine: lineNo,
      quantity: qtyVal,
      unit: isValidUom ? (uom!.toUpperCase() === 'EA' ? 'pcs' : uom!.toLowerCase()) : 'pcs',
      internalCode: itemCode || undefined,
      supplierCode: partNumber?.replace(/\s+/g, '') || undefined,
      reference: partNumber || itemCode || undefined,
      description: description,
    };
  }
}