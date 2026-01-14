import { Injectable, Logger } from '@nestjs/common';
import {
  ParseLog,
  SourceRecord,
  SourceType,
  NormalizedDocument,
  FilteredImage,
} from './types';
import { ImageFilterService, ImageMetadata } from './image-filter.service';
import { TableParserService, TableExtractionResult } from './table-parser.service';
import { EmailExtractorService } from './email-extractor.service';
import { WordParserService } from './word-parser.service';
import { ParseLogService, ParseLogBuilder } from './parse-log.service';
import { EmailAttachment, ParsedEmail, PriceRequestItem } from '../common/interfaces';
import * as pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Result of unified ingestion
 */
export interface IngestionResult {
  items: PriceRequestItem[];
  rfqNumber?: string;
  parseLog: ParseLog;
  warnings: string[];
  needsVerification: boolean;
}

/**
 * Unified Ingestion Service
 *
 * Orchestrates the complete ingestion pipeline:
 * 1. Email body extraction (text, HTML, inline images)
 * 2. Attachment processing (PDF, Excel, Word, images)
 * 3. Image filtering (signatures, icons)
 * 4. Document normalization
 * 5. Table parsing with header detection
 * 6. Item extraction and enrichment
 * 7. Parse log generation
 */
@Injectable()
export class UnifiedIngestionService {
  private readonly logger = new Logger(UnifiedIngestionService.name);

  private readonly imageFilter: ImageFilterService;
  private readonly emailExtractor: EmailExtractorService;
  private readonly wordParser: WordParserService;
  private readonly parseLogService: ParseLogService;

  constructor(private readonly tableParser: TableParserService) {
    this.imageFilter = new ImageFilterService();
    this.emailExtractor = new EmailExtractorService();
    this.wordParser = new WordParserService();
    this.parseLogService = new ParseLogService();
  }

  /**
   * Process a complete email with all attachments
   */
  async processEmail(
    email: ParsedEmail,
    requestId: string
  ): Promise<IngestionResult> {
    const logBuilder = this.parseLogService.createBuilder(requestId);
    const allItems: PriceRequestItem[] = [];
    const warnings: string[] = [];
    let rfqNumber: string | undefined;
    let needsVerification = false;

    // Auto-reload brands if the JSON file was modified
    try {
      const reloaded = await this.tableParser.checkAndReloadBrands();
      if (reloaded) {
        this.logger.log('Brands list reloaded from updated JSON file');
      }
    } catch (error) {
      this.logger.warn(`Failed to check brands reload: ${error.message}`);
    }

    // Extraire la marque du sujet de l'email (ex: "TR: DEMANDE DE COTATION manitou Ton 234")
    const subjectBrand = this.extractBrandFromSubject(email.subject);
    if (subjectBrand) {
      this.logger.debug(`Brand extracted from subject: ${subjectBrand}`);
    }

    try {
      // 1. Process email body
      const bodyResult = await this.processEmailBody(email, logBuilder);
      allItems.push(...bodyResult.items);
      if (bodyResult.rfqNumber) rfqNumber = bodyResult.rfqNumber;
      if (bodyResult.needsVerification) needsVerification = true;
      warnings.push(...bodyResult.warnings);

      // 2. Process attachments
      const attachmentResult = await this.processAttachments(
        email.attachments,
        logBuilder
      );
      allItems.push(...attachmentResult.items);
      if (!rfqNumber && attachmentResult.rfqNumber) {
        rfqNumber = attachmentResult.rfqNumber;
      }
      if (attachmentResult.needsVerification) needsVerification = true;
      warnings.push(...attachmentResult.warnings);

      // 3. Appliquer la marque du sujet aux items qui n'ont pas de marque valide
      if (subjectBrand) {
        for (const item of allItems) {
          // Si l'item n'a pas de marque ou a une marque incorrecte (fuzzy match erroné)
          if (!item.brand || this.isLikelyIncorrectBrand(item.brand, subjectBrand)) {
            item.brand = subjectBrand;
          }
        }
      }

      // 4. Deduplicate items
      const deduplicatedItems = this.deduplicateItems(allItems);
      logBuilder.setLineCount(deduplicatedItems.length);

      // 4. Build and save parse log
      const parseLog = logBuilder.build();

      // Save log file
      try {
        await this.parseLogService.saveLog(parseLog);
      } catch (error) {
        this.logger.warn(`Failed to save parse log: ${error.message}`);
      }

      return {
        items: deduplicatedItems,
        rfqNumber,
        parseLog,
        warnings,
        needsVerification,
      };
    } catch (error) {
      logBuilder.addError(error.message);
      const parseLog = logBuilder.build();

      return {
        items: [],
        parseLog,
        warnings: [error.message],
        needsVerification: true,
      };
    }
  }

  /**
   * Process email body (text, HTML, inline images)
   */
  private async processEmailBody(
    email: ParsedEmail,
    logBuilder: ParseLogBuilder
  ): Promise<{
    items: PriceRequestItem[];
    rfqNumber?: string;
    warnings: string[];
    needsVerification: boolean;
  }> {
    const items: PriceRequestItem[] = [];
    const warnings: string[] = [];
    let needsVerification = false;

    // Add source
    logBuilder.addSource({
      type: 'email_body_text',
      name: 'email_body',
      mime: 'text/plain',
    });

    // DEBUG: Log email body length and content
    this.logger.debug(`[DEBUG] Email body length: ${email.body?.length || 0} chars`);
    if (email.body && email.body.includes('Moteur')) {
      this.logger.debug(`[DEBUG] Email body contains 'Moteur'`);
    }
    // Log lines with bullet items
    const bulletLines = email.body?.split('\n').filter(l => l.includes('*') && l.includes('qty'));
    this.logger.debug(`[DEBUG] Bullet lines with qty: ${bulletLines?.length || 0}`);
    bulletLines?.forEach((line, idx) => {
      this.logger.debug(`[DEBUG] Bullet ${idx + 1}: "${line.substring(0, 60)}..."`);
    });

    // Extract content from email body
    const bodyParsed = await this.emailExtractor.parseEmailBody(
      email.body,
      email.attachments
    );

    // Log filtered images
    if (bodyParsed.filteredImages.length > 0) {
      logBuilder.addFilteredImages(bodyParsed.filteredImages);
    }

    // Log processed images
    if (bodyParsed.inlineImages.length > 0) {
      logBuilder.addProcessedImages(
        bodyParsed.inlineImages.map((img) => img.filename)
      );
    }

    // Create normalized document from email
    const normalizedDoc: NormalizedDocument = {
      sourceType: 'email_body_text',
      sourceName: 'email_body',
      hasPositions: false,
      rows: bodyParsed.rows,
      tables: bodyParsed.tables,
      rawText: bodyParsed.plainText,
    };

    // Parse email body content (tables, bullet lists, structured text)
    // Always parse if there's any content (rows or tables)
    this.logger.debug(`[DEBUG] bodyParsed.rows: ${bodyParsed.rows.length}, bodyParsed.tables: ${bodyParsed.tables.length}`);
    if (bodyParsed.rows.length > 0 || bodyParsed.tables.length > 0) {
      const tableResult = this.tableParser.parseDocument(normalizedDoc);
      this.logger.debug(`[DEBUG] tableParser extracted ${tableResult.items.length} items`);
      items.push(...tableResult.items);
      logBuilder.applyExtractionResult(tableResult);
    }

    // Try to extract RFQ number from subject + body
    const rfqNumber = this.extractRfqNumber(email.subject + ' ' + email.body);

    // Process inline images that passed filtering
    for (const inlineImage of bodyParsed.inlineImages) {
      try {
        const imageItems = await this.processImage(inlineImage, logBuilder);
        items.push(...imageItems);
        if (imageItems.length > 0) needsVerification = true;
      } catch (error) {
        warnings.push(`Failed to process inline image: ${error.message}`);
      }
    }

    return { items, rfqNumber, warnings, needsVerification };
  }

  /**
   * Process attachments (PDF, Excel, Word, Images)
   */
  private async processAttachments(
    attachments: EmailAttachment[],
    logBuilder: ParseLogBuilder
  ): Promise<{
    items: PriceRequestItem[];
    rfqNumber?: string;
    warnings: string[];
    needsVerification: boolean;
  }> {
    const items: PriceRequestItem[] = [];
    const warnings: string[] = [];
    let rfqNumber: string | undefined;
    let needsVerification = false;

    // Separate attachments by type
    const pdfs: EmailAttachment[] = [];
    const excels: EmailAttachment[] = [];
    const words: EmailAttachment[] = [];
    const images: EmailAttachment[] = [];

    for (const att of attachments) {
      const filename = att.filename.toLowerCase();
      const contentType = att.contentType?.toLowerCase() || '';

      if (filename.endsWith('.pdf') || contentType.includes('pdf')) {
        pdfs.push(att);
      } else if (
        filename.match(/\.xlsx?$/) ||
        contentType.includes('spreadsheet') ||
        contentType.includes('excel')
      ) {
        excels.push(att);
      } else if (
        filename.match(/\.docx?$/) ||
        contentType.includes('word') ||
        contentType.includes('document')
      ) {
        words.push(att);
      } else if (
        contentType.startsWith('image/') ||
        filename.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i)
      ) {
        images.push(att);
      }
    }

    // Process PDFs
    for (const pdf of pdfs) {
      try {
        logBuilder.addSource({
          type: 'attachment_pdf',
          name: pdf.filename,
          mime: pdf.contentType,
          size: pdf.size,
        });

        const result = await this.processPdf(pdf, logBuilder);
        items.push(...result.items);
        if (!rfqNumber && result.rfqNumber) rfqNumber = result.rfqNumber;
        if (result.needsVerification) needsVerification = true;
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(`Failed to process PDF ${pdf.filename}: ${error.message}`);
        logBuilder.addError(`PDF ${pdf.filename}: ${error.message}`);
      }
    }

    // Process Excel files
    for (const excel of excels) {
      try {
        logBuilder.addSource({
          type: 'attachment_excel',
          name: excel.filename,
          mime: excel.contentType,
          size: excel.size,
        });

        const result = await this.processExcel(excel, logBuilder);
        items.push(...result.items);
        if (!rfqNumber && result.rfqNumber) rfqNumber = result.rfqNumber;
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(
          `Failed to process Excel ${excel.filename}: ${error.message}`
        );
        logBuilder.addError(`Excel ${excel.filename}: ${error.message}`);
      }
    }

    // Process Word files
    for (const word of words) {
      try {
        logBuilder.addSource({
          type: 'attachment_word',
          name: word.filename,
          mime: word.contentType,
          size: word.size,
        });

        const result = await this.processWord(word, logBuilder);
        items.push(...result.items);
        if (!rfqNumber && result.rfqNumber) rfqNumber = result.rfqNumber;
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(
          `Failed to process Word ${word.filename}: ${error.message}`
        );
        logBuilder.addError(`Word ${word.filename}: ${error.message}`);
      }
    }

    // Filter and process images
    const imagesToFilter: ImageMetadata[] = images.map((att) => ({
      filename: att.filename,
      buffer: att.content,
      contentType: att.contentType,
      size: att.size,
      isInline: false,
      positionInEmail: 'unknown' as const,
    }));

    const { accepted, filtered } =
      await this.imageFilter.filterImages(imagesToFilter);

    logBuilder.addFilteredImages(filtered);
    logBuilder.addProcessedImages(accepted.map((img) => img.filename));

    // Process accepted images
    for (const image of accepted) {
      try {
        logBuilder.addSource({
          type: 'attachment_image',
          name: image.filename,
          mime: image.contentType,
          size: image.size,
        });

        const imageItems = await this.processImage(image, logBuilder);
        items.push(...imageItems);
        if (imageItems.length > 0) needsVerification = true;
      } catch (error) {
        warnings.push(`Failed to process image ${image.filename}: ${error.message}`);
        logBuilder.addError(`Image ${image.filename}: ${error.message}`);
      }
    }

    return { items, rfqNumber, warnings, needsVerification };
  }

  /**
   * Process a PDF attachment
   */
  private async processPdf(
    att: EmailAttachment,
    logBuilder: ParseLogBuilder
  ): Promise<{
    items: PriceRequestItem[];
    rfqNumber?: string;
    warnings: string[];
    needsVerification: boolean;
  }> {
    const warnings: string[] = [];
    let text = '';
    let needsVerification = false;
    let extractionMethod = 'pdf-parse';

    // Try pdftotext first
    try {
      text = await this.extractWithPdftotext(att.content);
      if (text && text.trim().length >= 50) {
        extractionMethod = 'pdftotext';
      }
    } catch {
      // Fallback to pdf-parse
    }

    // Fallback to pdf-parse
    if (!text || text.trim().length < 50) {
      try {
        const pdfParseDefault = (pdfParse as any).default || pdfParse;
        const data = await pdfParseDefault(att.content);
        if (data.text && data.text.trim().length > (text?.length || 0)) {
          text = data.text;
          extractionMethod = 'pdf-parse';
        }
      } catch (error) {
        warnings.push(`pdf-parse failed: ${error.message}`);
      }
    }

    // OCR fallback for scanned documents
    if (!text || text.trim().length < 50) {
      try {
        const ocrText = await this.extractWithOcr(att.content);
        if (ocrText && ocrText.trim().length > 20) {
          text = ocrText;
          extractionMethod = 'ocr';
          needsVerification = true;
          logBuilder.setOcrUsed([1], 'tesseract');
        }
      } catch (error) {
        warnings.push(`OCR failed: ${error.message}`);
      }
    }

    logBuilder.setExtractionMethod(extractionMethod);

    // Create normalized document
    const normalizedDoc: NormalizedDocument = {
      sourceType: 'attachment_pdf',
      sourceName: att.filename,
      hasPositions: false, // TODO: implement pdfjs token extraction
      rawText: text,
      rows: text.split('\n').map((line, idx) => ({
        raw: line,
        cells: line.split(/\s{2,}/),
        lineNumber: idx + 1,
      })),
    };

    // Parse document
    const result = this.tableParser.parseDocument(normalizedDoc);
    logBuilder.applyExtractionResult(result);

    // Extract RFQ number
    const rfqNumber = this.extractRfqNumber(text);

    return {
      items: result.items,
      rfqNumber,
      warnings: [...warnings, ...result.warnings],
      needsVerification,
    };
  }

  /**
   * Process an Excel attachment
   */
  private async processExcel(
    att: EmailAttachment,
    logBuilder: ParseLogBuilder
  ): Promise<{
    items: PriceRequestItem[];
    rfqNumber?: string;
    warnings: string[];
  }> {
    const workbook = XLSX.read(att.content, { type: 'buffer' });
    const tables: string[][][] = [];
    let allText = '';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      // Convert to string array
      const stringTable = jsonData.map((row) =>
        row.map((cell) => (cell != null ? String(cell) : ''))
      );
      tables.push(stringTable);

      allText += XLSX.utils.sheet_to_txt(sheet) + '\n';
    }

    logBuilder.setExtractionMethod('excel');

    // Create normalized document
    const normalizedDoc: NormalizedDocument = {
      sourceType: 'attachment_excel',
      sourceName: att.filename,
      hasPositions: false,
      tables,
      rawText: allText,
    };

    // Parse document
    const result = this.tableParser.parseDocument(normalizedDoc);
    logBuilder.applyExtractionResult(result);

    // Extract RFQ number
    const rfqNumber = this.extractRfqNumber(allText);

    return {
      items: result.items,
      rfqNumber,
      warnings: result.warnings,
    };
  }

  /**
   * Process a Word attachment
   */
  private async processWord(
    att: EmailAttachment,
    logBuilder: ParseLogBuilder
  ): Promise<{
    items: PriceRequestItem[];
    rfqNumber?: string;
    warnings: string[];
  }> {
    const normalizedDoc = await this.wordParser.createNormalizedDocument(att);
    logBuilder.setExtractionMethod('word');

    // Parse document
    const result = this.tableParser.parseDocument(normalizedDoc);
    logBuilder.applyExtractionResult(result);

    // Extract RFQ number
    const rfqNumber = this.extractRfqNumber(normalizedDoc.rawText);

    return {
      items: result.items,
      rfqNumber,
      warnings: result.warnings,
    };
  }

  /**
   * Process an image (OCR)
   */
  private async processImage(
    image: ImageMetadata,
    logBuilder: ParseLogBuilder
  ): Promise<PriceRequestItem[]> {
    const tmpPath = path.join(
      os.tmpdir(),
      `img_${Date.now()}_${image.filename}`
    );

    try {
      fs.writeFileSync(tmpPath, image.buffer);

      // Run OCR
      const text = execSync(
        `tesseract "${tmpPath}" stdout -l eng+fra 2>/dev/null`,
        { timeout: 30000 }
      ).toString();

      logBuilder.setOcrUsed([1], 'tesseract');

      // Extract nameplate info
      const item = this.extractFromNameplate(text, image.filename);
      return item ? [item] : [];
    } catch (error) {
      this.logger.warn(`OCR failed for ${image.filename}: ${error.message}`);
      return [];
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
    }
  }

  /**
   * Extract text using pdftotext
   */
  private async extractWithPdftotext(buffer: Buffer): Promise<string> {
    const tmpFile = path.join(
      os.tmpdir(),
      `pdf_${Date.now()}_${Math.random().toString(36).substr(2)}.pdf`
    );

    try {
      fs.writeFileSync(tmpFile, buffer);
      return execSync(`pdftotext -layout "${tmpFile}" -`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
    } finally {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {}
    }
  }

  /**
   * Extract text using OCR
   */
  private async extractWithOcr(buffer: Buffer): Promise<string> {
    const tmpPdf = path.join(os.tmpdir(), `ocr_${Date.now()}.pdf`);
    const tmpImg = path.join(os.tmpdir(), `ocr_${Date.now()}.png`);

    try {
      fs.writeFileSync(tmpPdf, buffer);

      // Convert PDF to image
      try {
        execSync(
          `pdftoppm -png -r 300 -singlefile "${tmpPdf}" "${tmpImg.replace('.png', '')}"`,
          { timeout: 60000 }
        );
      } catch {
        return '';
      }

      if (!fs.existsSync(tmpImg)) return '';

      // Run OCR
      return execSync(`tesseract "${tmpImg}" stdout -l fra+eng --psm 6 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } finally {
      try {
        if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
        if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
      } catch {}
    }
  }

  /**
   * Extract RFQ number from text
   */
  private extractRfqNumber(text: string): string | undefined {
    const patterns = [
      /Purchase\s+Requisitions?\s+No[:\s]*(\d+)/gi,
      /PR[\s\-_]*(\d{6,})/gi,
      /(?:RFQ|RFP|REF|N°|No\.|Référence|Reference|Demande)\s*[:\-#]?\s*([A-Z0-9][\w\-\/]+)/gi,
      /([A-Z]{2,4}[\-\/]?\d{4,}[\-\/]?\d{0,4})/g,
    ];

    for (const pattern of patterns) {
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

  /**
   * Extract item from nameplate OCR
   */
  private extractFromNameplate(
    text: string,
    filename: string
  ): PriceRequestItem | null {
    const upperText = text.toUpperCase();

    // Extract part number
    let partNumber: string | undefined;
    const pnPatterns = [
      /P\/N[:\s]*([A-Z0-9\-\/\s]+)/i,
      /PART\s*(?:NO|NUMBER|#)?[:\s]*([A-Z0-9\-\/\s]+)/i,
      /REF[:\s]*([A-Z0-9\-\/]+)/i,
    ];
    for (const pattern of pnPatterns) {
      const match = upperText.match(pattern);
      if (match) {
        partNumber = match[1].trim().replace(/\s+/g, ' ');
        break;
      }
    }

    // Extract brand
    const brands = [
      'DANA', 'SPICER', 'TEREX', 'CATERPILLAR', 'CAT', 'KOMATSU',
      'PARKER', 'REXROTH', 'BOSCH', 'SKF', 'TIMKEN',
    ];
    let brand: string | undefined;
    for (const b of brands) {
      if (upperText.includes(b)) {
        brand = b;
        break;
      }
    }

    if (partNumber || brand) {
      return {
        description: `Pièce détachée (voir image: ${filename})`,
        quantity: 1,
        unit: 'pcs',
        supplierCode: partNumber,
        brand,
        needsManualReview: true,
        notes: `OCR from image: ${filename}`,
      };
    }

    return null;
  }

  /**
   * Deduplicate items by description + quantity
   */
  private deduplicateItems(items: PriceRequestItem[]): PriceRequestItem[] {
    const seen = new Map<string, PriceRequestItem>();

    for (const item of items) {
      const key = `${item.description.toLowerCase()}-${item.quantity}`;
      if (!seen.has(key)) {
        seen.set(key, item);
      } else {
        // Merge: keep the one with more info
        const existing = seen.get(key)!;
        if (!existing.brand && item.brand) existing.brand = item.brand;
        if (!existing.supplierCode && item.supplierCode)
          existing.supplierCode = item.supplierCode;
        if (!existing.reference && item.reference)
          existing.reference = item.reference;
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Extraire la marque depuis le sujet de l'email
   * Ex: "TR: DEMANDE DE COTATION manitou Ton 234" -> "MANITOU"
   */
  private extractBrandFromSubject(subject: string): string | undefined {
    if (!subject) return undefined;

    // Liste des marques connues à chercher dans le sujet
    const knownBrands = [
      'MANITOU', 'CATERPILLAR', 'CAT', 'KOMATSU', 'VOLVO', 'TEREX',
      'JOHN DEERE', 'DEERE', 'JCB', 'LIEBHERR', 'CASE', 'NEW HOLLAND',
      'HITACHI', 'KOBELCO', 'HYUNDAI', 'DOOSAN', 'DAEWOO', 'KUBOTA',
      'BOBCAT', 'TAKEUCHI', 'YANMAR', 'SANDVIK', 'ATLAS COPCO',
      'CUMMINS', 'PERKINS', 'DEUTZ', 'IVECO', 'SCANIA', 'MERCEDES',
      'MAN', 'DAF', 'RENAULT', 'CLAAS', 'FENDT', 'MASSEY FERGUSON',
      'SAME', 'LAMBORGHINI', 'DEUTZ-FAHR', 'VALTRA', 'FORD',
      'BELL', 'GROVE', 'TADANO', 'DEMAG', 'POTAIN', 'ZOOMLION',
      'SANY', 'XCMG', 'SDLG', 'LIUGONG', 'SHANTUI', 'LONKING',
      'DANA', 'SPICER', 'PARKER', 'REXROTH', 'BOSCH', 'SKF', 'TIMKEN',
      'FIRETROL', 'GRUNDFOS', 'PENTAIR', 'CONTRINEX', 'SIEMENS', 'ABB',
    ];

    const subjectUpper = subject.toUpperCase();

    // Chercher une marque connue dans le sujet
    for (const brand of knownBrands) {
      // Vérifier que c'est un mot complet (pas partie d'un autre mot)
      const regex = new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(subjectUpper)) {
        return brand;
      }
    }

    return undefined;
  }

  /**
   * Vérifie si une marque détectée est probablement incorrecte
   * (fuzzy match erroné vs marque du sujet)
   */
  private isLikelyIncorrectBrand(detectedBrand: string, subjectBrand: string): boolean {
    if (!detectedBrand || !subjectBrand) return false;

    const detected = detectedBrand.toUpperCase();
    const subject = subjectBrand.toUpperCase();

    // Si c'est la même marque, pas d'erreur
    if (detected === subject) return false;

    // Marques qui sont souvent des faux positifs par fuzzy matching
    // quand la vraie marque est différente
    const likelyFalsePositives = [
      'FIRETROL',   // Match faux pour "FILTRE"
      'CONTRINEX', // Match faux pour codes numériques
      'PENTAIR',    // Match faux pour "PREFILTRE"
    ];

    return likelyFalsePositives.includes(detected);
  }
}
