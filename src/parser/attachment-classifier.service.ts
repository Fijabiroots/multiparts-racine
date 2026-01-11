import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import { EmailAttachment, PriceRequestItem, ExtractedPdfData } from '../common/interfaces';

/**
 * Types d'attachements
 */
export type AttachmentCategory = 'rfq' | 'technical_sheet' | 'image' | 'unknown';

/**
 * Résultat de classification d'une pièce jointe
 */
export interface ClassifiedAttachment {
  attachment: EmailAttachment;
  category: AttachmentCategory;
  confidence: number; // 0-100
  reason: string;
  relatedTo?: string; // Nom du fichier RFQ associé (pour les fiches techniques)
  brand?: string; // Marque détectée
  rfqNumber?: string; // Numéro RFQ détecté dans le nom de fichier
}

/**
 * Résultat d'analyse d'un classeur Excel
 */
export interface ExcelWorkbookAnalysis {
  filename: string;
  sheets: ExcelSheetInfo[];
  hasMulipleDistinctRequests: boolean;
}

export interface ExcelSheetInfo {
  name: string;
  itemCount: number;
  brands: string[];
  rfqNumber?: string;
  isDistinctRequest: boolean;
}

/**
 * Groupe de demandes par marque
 */
export interface BrandGroup {
  brand: string;
  attachments: ClassifiedAttachment[];
  items: PriceRequestItem[];
  technicalSheets: ClassifiedAttachment[];
}

@Injectable()
export class AttachmentClassifierService {
  private readonly logger = new Logger(AttachmentClassifierService.name);

  // Mots-clés indiquant une fiche technique
  private readonly technicalSheetKeywords = [
    // Français
    'fiche technique', 'fiche_technique', 'fiche-technique', 'fichetechnique',
    'datasheet', 'data_sheet', 'data-sheet',
    'specification', 'spécification', 'spec',
    'technical', 'technique',
    'catalogue', 'catalog',
    'documentation', 'doc',
    'brochure',
    'manuel', 'manual',
    'notice',
    'plan', 'drawing', 'dessin',
    'schema', 'schéma',
    // Patterns spécifiques
    '_ft_', '-ft-', '_ft.', '-ft.',
    '_ds_', '-ds-', '_ds.', '-ds.',
    '_tech_', '-tech-',
  ];

  // Mots-clés indiquant une demande de prix
  private readonly rfqKeywords = [
    'rfq', 'rfi', 'rfp',
    'demande', 'request', 'quotation', 'quote',
    'requisition', 'pr-', 'pr_',
    'commande', 'order',
    'bi_', 'bi-', // Business Intelligence / Internal numbering
    'devis', 'cotation',
    'achat', 'purchase',
  ];

  // Marques connues pour la détection
  private readonly knownBrands = [
    'TEREX', 'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI', 'VOLVO', 'LIEBHERR',
    'SANDVIK', 'EPIROC', 'METSO', 'ATLAS COPCO', 'JOHN DEERE', 'BELL',
    'SKF', 'FAG', 'NSK', 'NTN', 'TIMKEN', 'INA', 'KOYO',
    'SIEMENS', 'ABB', 'SCHNEIDER', 'ALLEN BRADLEY', 'ROCKWELL', 'OMRON',
    'PARKER', 'REXROTH', 'BOSCH', 'FESTO', 'SMC', 'EATON', 'VICKERS',
    'DANA', 'CARRARO', 'ZF', 'CLARK', 'ALLISON', 'SPICER',
    'CUMMINS', 'PERKINS', 'DEUTZ', 'SCANIA', 'MAN', 'MERCEDES',
    'GATES', 'DONALDSON', 'FLEETGUARD', 'MANN', 'HENGST',
    'HTM', 'FLUKE', '3M', 'LOCTITE',
  ];

  /**
   * Classifier toutes les pièces jointes d'un email
   */
  classifyAttachments(attachments: EmailAttachment[]): ClassifiedAttachment[] {
    const classified: ClassifiedAttachment[] = [];
    const rfqAttachments: ClassifiedAttachment[] = [];
    const techSheets: ClassifiedAttachment[] = [];

    // Premier passage: classifier chaque pièce jointe
    for (const attachment of attachments) {
      const result = this.classifyAttachment(attachment);
      classified.push(result);

      if (result.category === 'rfq') {
        rfqAttachments.push(result);
      } else if (result.category === 'technical_sheet') {
        techSheets.push(result);
      }
    }

    // Deuxième passage: associer les fiches techniques aux RFQs
    for (const techSheet of techSheets) {
      const matchingRfq = this.findMatchingRfq(techSheet, rfqAttachments);
      if (matchingRfq) {
        techSheet.relatedTo = matchingRfq.attachment.filename;
        this.logger.debug(`Fiche technique "${techSheet.attachment.filename}" associée à "${matchingRfq.attachment.filename}"`);
      }
    }

    return classified;
  }

  /**
   * Classifier une seule pièce jointe
   */
  private classifyAttachment(attachment: EmailAttachment): ClassifiedAttachment {
    const filename = attachment.filename.toLowerCase();
    const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');

    // Détecter la marque
    const brand = this.detectBrandFromFilename(filename);

    // Détecter le numéro RFQ
    const rfqNumber = this.extractRfqNumberFromFilename(filename);

    // Ignorer les images de signature Outlook
    if (this.isSignatureImage(filename, attachment.size)) {
      return {
        attachment,
        category: 'image',
        confidence: 100,
        reason: 'Image de signature/logo ignorée',
        brand,
      };
    }

    // Images qui ne sont pas des signatures
    if (/\.(png|jpg|jpeg|gif|bmp|tiff?)$/.test(filename)) {
      return {
        attachment,
        category: 'image',
        confidence: 80,
        reason: 'Image potentiellement utile (plaque signalétique, photo pièce)',
        brand,
      };
    }

    // Score pour fiche technique
    let techScore = 0;
    let techReasons: string[] = [];

    for (const keyword of this.technicalSheetKeywords) {
      if (filenameWithoutExt.includes(keyword)) {
        techScore += 20;
        techReasons.push(`Mot-clé "${keyword}" trouvé`);
      }
    }

    // Score pour RFQ
    let rfqScore = 0;
    let rfqReasons: string[] = [];

    for (const keyword of this.rfqKeywords) {
      if (filenameWithoutExt.includes(keyword)) {
        rfqScore += 15;
        rfqReasons.push(`Mot-clé "${keyword}" trouvé`);
      }
    }

    // Bonus pour les fichiers avec numéro RFQ
    if (rfqNumber) {
      rfqScore += 25;
      rfqReasons.push(`Numéro RFQ détecté: ${rfqNumber}`);
    }

    // Les fichiers Excel sont généralement des RFQs
    if (/\.(xlsx?|csv)$/.test(filename)) {
      rfqScore += 20;
      rfqReasons.push('Format Excel (typiquement RFQ)');
    }

    // Les fichiers PDF sans indication claire
    if (/\.pdf$/.test(filename) && techScore === 0 && rfqScore === 0) {
      // Par défaut, traiter comme RFQ sauf si très petit fichier
      if (attachment.size && attachment.size < 50000) {
        techScore += 10;
        techReasons.push('Petit fichier PDF (potentiellement fiche technique)');
      } else {
        rfqScore += 10;
        rfqReasons.push('Fichier PDF sans indication claire');
      }
    }

    // Déterminer la catégorie
    if (techScore > rfqScore && techScore >= 20) {
      return {
        attachment,
        category: 'technical_sheet',
        confidence: Math.min(100, techScore),
        reason: techReasons.join('; '),
        brand,
        rfqNumber,
      };
    }

    if (rfqScore >= 10 || /\.(pdf|xlsx?|csv|doc|docx)$/.test(filename)) {
      return {
        attachment,
        category: 'rfq',
        confidence: Math.min(100, Math.max(50, rfqScore)),
        reason: rfqReasons.length > 0 ? rfqReasons.join('; ') : 'Document standard traité comme RFQ',
        brand,
        rfqNumber,
      };
    }

    return {
      attachment,
      category: 'unknown',
      confidence: 30,
      reason: 'Type non déterminé',
      brand,
      rfqNumber,
    };
  }

  /**
   * Trouver le RFQ correspondant à une fiche technique
   */
  private findMatchingRfq(
    techSheet: ClassifiedAttachment,
    rfqAttachments: ClassifiedAttachment[],
  ): ClassifiedAttachment | null {
    if (rfqAttachments.length === 0) return null;
    if (rfqAttachments.length === 1) return rfqAttachments[0];

    const techFilename = techSheet.attachment.filename.toLowerCase();
    const techBrand = techSheet.brand;

    // Chercher par marque
    if (techBrand) {
      for (const rfq of rfqAttachments) {
        if (rfq.brand === techBrand) {
          return rfq;
        }
      }
    }

    // Chercher par similitude de nom
    for (const rfq of rfqAttachments) {
      const rfqFilename = rfq.attachment.filename.toLowerCase();

      // Extraire les parties communes
      const techParts = this.extractFilenameParts(techFilename);
      const rfqParts = this.extractFilenameParts(rfqFilename);

      // Calculer le score de similitude
      let matchScore = 0;
      for (const part of techParts) {
        if (rfqParts.includes(part) && part.length > 3) {
          matchScore += part.length;
        }
      }

      if (matchScore > 10) {
        return rfq;
      }
    }

    // Par défaut, associer au premier RFQ
    return rfqAttachments[0];
  }

  /**
   * Extraire les parties significatives d'un nom de fichier
   */
  private extractFilenameParts(filename: string): string[] {
    return filename
      .replace(/\.[^.]+$/, '')
      .split(/[-_\s.]+/)
      .filter(part => part.length > 2)
      .map(part => part.toLowerCase());
  }

  /**
   * Détecter la marque depuis le nom de fichier
   */
  private detectBrandFromFilename(filename: string): string | undefined {
    const upper = filename.toUpperCase();
    for (const brand of this.knownBrands) {
      if (upper.includes(brand)) {
        return brand;
      }
    }
    return undefined;
  }

  /**
   * Extraire le numéro RFQ depuis le nom de fichier
   */
  private extractRfqNumberFromFilename(filename: string): string | undefined {
    const patterns = [
      /\b(BI|PR|RFQ|REF)[-_]?(\d{4,})/i,
      /\b(\d{6,8})\b/, // Numéro de 6-8 chiffres
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        return match[0].toUpperCase();
      }
    }
    return undefined;
  }

  /**
   * Vérifier si c'est une image de signature/logo (sync version, filename/size only)
   */
  isSignatureImage(filename: string, size?: number): boolean {
    const lower = filename.toLowerCase();

    // Patterns d'images de signature
    const signaturePatterns = [
      /outlook/i,
      /^image\d+\./i,
      /logo/i,
      /^(signature|footer|banner|header)/i,
      /^att\d+\./i,
      /desc\.(png|jpg|jpeg|gif)$/i,
      /^cid[:\-_]/i,
      /^[a-f0-9]{8,}[-_]/i,
      /^inline/i,
      /icon/i,
      /spacer/i,
      /pixel/i,
      /tracking/i,
    ];

    for (const pattern of signaturePatterns) {
      if (pattern.test(lower)) return true;
    }

    // Très petites images
    if (size && size < 10000) return true;

    return false;
  }

  /**
   * Advanced image signature detection using sharp for dimensions
   * Returns { isSignature: boolean, reason: string, dimensions?: { width, height, ratio } }
   */
  async isSignatureImageAdvanced(
    attachment: EmailAttachment
  ): Promise<{ isSignature: boolean; reason: string; dimensions?: { width: number; height: number; ratio: number } }> {
    const filename = attachment.filename.toLowerCase();

    // Quick check with filename patterns first
    if (this.isSignatureImage(filename, attachment.size)) {
      return { isSignature: true, reason: 'Filename pattern matches signature/logo' };
    }

    // Only process actual images
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    const isImage = imageExtensions.some(ext => filename.endsWith(ext));

    if (!isImage) {
      return { isSignature: false, reason: 'Not an image file' };
    }

    // Need content for dimension analysis
    if (!attachment.content) {
      return { isSignature: false, reason: 'No content available for analysis' };
    }

    try {
      // Get image metadata with sharp
      const buffer = typeof attachment.content === 'string'
        ? Buffer.from(attachment.content, 'base64')
        : attachment.content;

      const metadata = await sharp(buffer).metadata();

      if (!metadata.width || !metadata.height) {
        return { isSignature: false, reason: 'Could not read image dimensions' };
      }

      const width = metadata.width;
      const height = metadata.height;
      const area = width * height;
      const ratio = width / height;

      const dimensions = { width, height, ratio: Math.round(ratio * 100) / 100 };

      // Very small area (icons, tracking pixels)
      if (area < 25000 || (width < 80 && height < 80)) {
        return {
          isSignature: true,
          reason: `Tiny image (${width}x${height}, area=${area})`,
          dimensions,
        };
      }

      // Extreme ratio - banner or spacer
      if (ratio > 6 || ratio < 0.16) {
        return {
          isSignature: true,
          reason: `Extreme aspect ratio (${ratio.toFixed(2)}) - likely banner/spacer`,
          dimensions,
        };
      }

      // Typical signature banner: wide and short
      if (width > 600 && height < 200) {
        return {
          isSignature: true,
          reason: `Signature banner dimensions (${width}x${height})`,
          dimensions,
        };
      }

      // Email tracking pixel (1x1 or very small)
      if ((width === 1 && height === 1) || area < 100) {
        return {
          isSignature: true,
          reason: 'Tracking pixel',
          dimensions,
        };
      }

      // Seems like a legitimate image
      return {
        isSignature: false,
        reason: `Valid image dimensions (${width}x${height})`,
        dimensions,
      };
    } catch (error) {
      this.logger.debug(`Could not analyze image ${filename}: ${error.message}`);
      return { isSignature: false, reason: 'Error analyzing image' };
    }
  }

  /**
   * Filter signature images from a list of attachments
   * Returns filtered list and skipped images with reasons
   */
  async filterSignatureImages(
    attachments: EmailAttachment[]
  ): Promise<{
    validImages: EmailAttachment[];
    skipped: Array<{ attachment: EmailAttachment; reason: string; dimensions?: { width: number; height: number; ratio: number } }>;
  }> {
    const validImages: EmailAttachment[] = [];
    const skipped: Array<{ attachment: EmailAttachment; reason: string; dimensions?: { width: number; height: number; ratio: number } }> = [];

    for (const attachment of attachments) {
      const filename = attachment.filename.toLowerCase();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
      const isImage = imageExtensions.some(ext => filename.endsWith(ext));

      if (!isImage) {
        validImages.push(attachment);
        continue;
      }

      const result = await this.isSignatureImageAdvanced(attachment);

      if (result.isSignature) {
        skipped.push({
          attachment,
          reason: result.reason,
          dimensions: result.dimensions,
        });
        this.logger.debug(`Filtered signature image: ${attachment.filename} - ${result.reason}`);
      } else {
        validImages.push(attachment);
      }
    }

    return { validImages, skipped };
  }

  /**
   * Analyser un classeur Excel pour détecter les feuilles distinctes
   */
  analyzeExcelWorkbook(buffer: Buffer, filename: string): ExcelWorkbookAnalysis {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets: ExcelSheetInfo[] = [];
    let hasMultipleDistinctRequests = false;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      // Compter les lignes avec contenu
      const contentRows = jsonData.filter(row =>
        row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
      );

      // Détecter les marques dans la feuille
      const brands = this.detectBrandsInSheet(jsonData);

      // Détecter le numéro RFQ
      const rfqNumber = this.detectRfqInSheet(jsonData, sheetName);

      // Déterminer si c'est une demande distincte
      const isDistinctRequest = contentRows.length > 3; // Au moins 3 lignes de contenu

      sheets.push({
        name: sheetName,
        itemCount: Math.max(0, contentRows.length - 1), // Moins l'en-tête
        brands,
        rfqNumber,
        isDistinctRequest,
      });
    }

    // Vérifier si on a plusieurs demandes distinctes
    const distinctSheets = sheets.filter(s => s.isDistinctRequest);
    if (distinctSheets.length > 1) {
      // Vérifier si les feuilles ont des marques ou RFQ différents
      const uniqueBrands = new Set(distinctSheets.flatMap(s => s.brands));
      const uniqueRfqs = new Set(distinctSheets.map(s => s.rfqNumber).filter(Boolean));

      hasMultipleDistinctRequests = uniqueBrands.size > 1 || uniqueRfqs.size > 1;
    }

    return {
      filename,
      sheets,
      hasMulipleDistinctRequests: hasMultipleDistinctRequests,
    };
  }

  /**
   * Détecter les marques dans une feuille Excel
   */
  private detectBrandsInSheet(data: any[][]): string[] {
    const foundBrands = new Set<string>();
    const textContent = data
      .flat()
      .filter(cell => cell !== null && cell !== undefined)
      .map(cell => String(cell).toUpperCase())
      .join(' ');

    for (const brand of this.knownBrands) {
      if (textContent.includes(brand)) {
        foundBrands.add(brand);
      }
    }

    return Array.from(foundBrands);
  }

  /**
   * Détecter le numéro RFQ dans une feuille Excel
   */
  private detectRfqInSheet(data: any[][], sheetName: string): string | undefined {
    // Chercher dans le nom de la feuille
    const sheetMatch = sheetName.match(/(BI|PR|RFQ|REF)[-_]?\d+/i);
    if (sheetMatch) return sheetMatch[0].toUpperCase();

    // Chercher dans les premières lignes
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (!row) continue;

      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const cellStr = String(cell);
        const match = cellStr.match(/(BI|PR|RFQ|REF)[-_]?\d+/i);
        if (match) return match[0].toUpperCase();
      }
    }

    return undefined;
  }

  /**
   * Grouper les attachements par marque
   */
  groupByBrand(classified: ClassifiedAttachment[]): Map<string, ClassifiedAttachment[]> {
    const groups = new Map<string, ClassifiedAttachment[]>();

    for (const item of classified) {
      const brand = item.brand || 'UNKNOWN';

      if (!groups.has(brand)) {
        groups.set(brand, []);
      }
      groups.get(brand)!.push(item);
    }

    return groups;
  }

  /**
   * Vérifier si toutes les demandes ont la même marque
   */
  allSameBrand(classified: ClassifiedAttachment[]): boolean {
    const rfqs = classified.filter(c => c.category === 'rfq');
    if (rfqs.length <= 1) return true;

    const brands = rfqs.map(r => r.brand).filter(Boolean);
    if (brands.length === 0) return true;

    return new Set(brands).size === 1;
  }
}
