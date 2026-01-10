import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ColumnType,
  DetectedColumn,
  COLUMN_DICTIONARY,
  COLUMN_WEIGHTS,
  TextToken,
  ParsedRow,
  NormalizedDocument,
} from './types';
import { PriceRequestItem } from '../common/interfaces';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Structure du fichier brands JSON
 */
interface BrandsCategory {
  key: string;
  label: string;
  examples: string[];
  brands: string[];
}

interface BrandsFile {
  generated_at_utc: string;
  source_file: string;
  total_unique_brands: number;
  categories: BrandsCategory[];
}

/**
 * Configuration for table parsing
 */
export interface TableParserConfig {
  minHeaderScore?: number;        // Minimum score to consider as header (0-1)
  maxHeaderSearchLines?: number;  // Max lines to search for header
  fuzzyMatchThreshold?: number;   // Fuzzy match threshold (0-1)
  mergeMultilineDescriptions?: boolean;
}

/**
 * Header detection result
 */
export interface HeaderDetection {
  found: boolean;
  score: number;
  lineIndex: number;
  pageIndex?: number;
  columns: DetectedColumn[];
  rawHeaderText: string;
}

/**
 * Table extraction result
 */
export interface TableExtractionResult {
  items: PriceRequestItem[];
  headerDetection: HeaderDetection;
  warnings: string[];
  extractionMethod: 'positions' | 'columns' | 'heuristic';
}

/**
 * Default parser configuration
 */
const DEFAULT_CONFIG: Required<TableParserConfig> = {
  minHeaderScore: 8,              // Score pondéré minimum (était 0.3 en %)
  maxHeaderSearchLines: 30,
  fuzzyMatchThreshold: 0.75,      // Seuil fuzzy légèrement plus strict
  mergeMultilineDescriptions: true,
};

/**
 * Unified Table Parser Service
 *
 * Provides consistent table parsing across different document types:
 * - PDF (with X/Y positions)
 * - Excel (column-based)
 * - Word/Email (text heuristics)
 *
 * Uses header detection with fuzzy matching to identify columns.
 */
/**
 * Path to the brands JSON file
 */
const BRANDS_FILE_PATH = path.join(process.cwd(), 'data', 'brands_grouped_by_category.json');

/**
 * Fallback brands list (used when JSON file is not available)
 */
const FALLBACK_BRANDS = [
  'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI', 'VOLVO', 'LIEBHERR', 'SANDVIK',
  'SKF', 'FAG', 'NSK', 'NTN', 'TIMKEN', 'SIEMENS', 'ABB', 'SCHNEIDER',
  'PARKER', 'REXROTH', 'BOSCH', 'FESTO', 'EATON', 'CUMMINS', 'PERKINS',
  'DONALDSON', 'MANN', 'FLEETGUARD', 'GATES', 'FLUKE', 'MICHELIN', 'BRIDGESTONE',
];

@Injectable()
export class TableParserService implements OnModuleInit {
  private readonly logger = new Logger(TableParserService.name);
  private readonly config: Required<TableParserConfig>;
  private knownBrands: string[] = [];
  private brandsLastLoaded: Date | null = null;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Update parser configuration
   */
  configure(config: Partial<TableParserConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Initialize the service by loading brands from JSON file
   */
  async onModuleInit(): Promise<void> {
    await this.loadBrandsFromFile();
  }

  /**
   * Load brands from JSON file
   * Can be called to reload brands after file update
   */
  async loadBrandsFromFile(): Promise<void> {
    try {
      if (!fs.existsSync(BRANDS_FILE_PATH)) {
        this.logger.warn(`Brands file not found at ${BRANDS_FILE_PATH}, using fallback list`);
        this.knownBrands = FALLBACK_BRANDS;
        return;
      }

      const fileContent = fs.readFileSync(BRANDS_FILE_PATH, 'utf-8');
      const data: BrandsFile = JSON.parse(fileContent);

      // Flatten all brands from all categories into a single array
      const allBrands = new Set<string>();
      for (const category of data.categories) {
        for (const brand of category.brands) {
          // Normalize: uppercase and trim
          allBrands.add(brand.toUpperCase().trim());
        }
      }

      this.knownBrands = Array.from(allBrands);
      this.brandsLastLoaded = new Date();

      this.logger.log(
        `Loaded ${this.knownBrands.length} brands from ${BRANDS_FILE_PATH} (${data.categories.length} categories)`
      );
    } catch (error) {
      this.logger.error(`Failed to load brands from file: ${error.message}`);
      this.knownBrands = FALLBACK_BRANDS;
    }
  }

  /**
   * Get the list of known brands (for external use)
   */
  getKnownBrands(): string[] {
    return [...this.knownBrands];
  }

  /**
   * Check if brands need reloading (file modified)
   */
  async checkAndReloadBrands(): Promise<boolean> {
    try {
      if (!fs.existsSync(BRANDS_FILE_PATH)) return false;

      const stats = fs.statSync(BRANDS_FILE_PATH);
      if (!this.brandsLastLoaded || stats.mtime > this.brandsLastLoaded) {
        await this.loadBrandsFromFile();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Parse a normalized document and extract items
   */
  parseDocument(doc: NormalizedDocument): TableExtractionResult {
    const warnings: string[] = [];
    let extractionMethod: 'positions' | 'columns' | 'heuristic' = 'heuristic';

    // 1. Detect header
    const headerDetection = this.detectHeader(doc);

    if (!headerDetection.found) {
      warnings.push('No header row detected - using heuristic parsing');
    } else {
      this.logger.debug(
        `Header detected at line ${headerDetection.lineIndex} with score ${headerDetection.score.toFixed(2)}`
      );
    }

    // 2. Extract items based on document type
    let items: PriceRequestItem[] = [];

    if (doc.hasPositions && doc.tokens && doc.tokens.length > 0) {
      // Position-based extraction (PDF with pdfjs tokens)
      items = this.extractWithPositions(doc.tokens, headerDetection);
      extractionMethod = 'positions';
    } else if (doc.tables && doc.tables.length > 0) {
      // Column-based extraction (Excel/Word tables)
      items = this.extractFromTables(doc.tables, headerDetection);
      extractionMethod = 'columns';
    } else if (doc.rows && doc.rows.length > 0) {
      // Heuristic extraction (text-based)
      items = this.extractFromRows(doc.rows, headerDetection);
      extractionMethod = 'heuristic';
    } else {
      // Fallback: parse raw text
      items = this.extractFromRawText(doc.rawText);
      extractionMethod = 'heuristic';
    }

    // 3. Post-process items
    items = this.postProcessItems(items, warnings);

    return {
      items,
      headerDetection,
      warnings,
      extractionMethod,
    };
  }

  /**
   * Detect header row in the document
   */
  detectHeader(doc: NormalizedDocument): HeaderDetection {
    const noHeader: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    // Check rows first
    if (doc.rows && doc.rows.length > 0) {
      return this.detectHeaderInRows(doc.rows);
    }

    // Check tables
    if (doc.tables && doc.tables.length > 0) {
      for (let tableIdx = 0; tableIdx < doc.tables.length; tableIdx++) {
        const table = doc.tables[tableIdx];
        const result = this.detectHeaderInTable(table);
        if (result.found && result.score >= this.config.minHeaderScore) {
          return result;
        }
      }
    }

    // Check raw text as rows
    if (doc.rawText) {
      const textRows = doc.rawText.split('\n').map((line, idx) => ({
        raw: line,
        cells: this.splitRowIntoCells(line),
        lineNumber: idx,
      }));
      return this.detectHeaderInRows(textRows);
    }

    return noHeader;
  }

  /**
   * Detect header in an array of rows
   * Utilise une fenêtre glissante de 2 lignes pour gérer les en-têtes cassés
   */
  private detectHeaderInRows(rows: ParsedRow[]): HeaderDetection {
    const maxSearch = Math.min(rows.length, this.config.maxHeaderSearchLines);
    let bestResult: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    for (let i = 0; i < maxSearch; i++) {
      const row = rows[i];
      const cells = row.cells.length > 0 ? row.cells : this.splitRowIntoCells(row.raw);

      // 1. Analyser la ligne seule
      const singleLineDetection = this.analyzeHeaderCandidateRow(cells, i);

      if (singleLineDetection.score > bestResult.score) {
        bestResult = {
          ...singleLineDetection,
          rawHeaderText: row.raw,
        };
      }

      // 2. Analyser 2 lignes combinées (fenêtre glissante)
      // Utile quand l'en-tête est cassé sur 2 lignes
      if (i + 1 < rows.length) {
        const nextRow = rows[i + 1];
        const nextCells = nextRow.cells.length > 0
          ? nextRow.cells
          : this.splitRowIntoCells(nextRow.raw);

        // Combiner le texte des 2 lignes
        const combinedText = row.raw + ' ' + nextRow.raw;
        const combinedCells = this.splitRowIntoCells(combinedText);

        const twoLineDetection = this.analyzeHeaderCandidateRow(combinedCells, i);

        // Bonus pour la combinaison si elle trouve plus de colonnes clés
        if (twoLineDetection.score > bestResult.score) {
          bestResult = {
            ...twoLineDetection,
            rawHeaderText: combinedText,
          };
          // On skip la ligne suivante car elle fait partie de l'en-tête
          i++;
        }
      }

      // Early exit si on trouve un très bon en-tête (score pondéré >= 15)
      if (bestResult.score >= 15) {
        break;
      }
    }

    return bestResult;
  }

  /**
   * Detect header in a table (2D array)
   */
  private detectHeaderInTable(table: string[][]): HeaderDetection {
    const maxSearch = Math.min(table.length, this.config.maxHeaderSearchLines);
    let bestResult: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    for (let i = 0; i < maxSearch; i++) {
      const row = table[i];
      if (!row || row.length === 0) continue;

      const detection = this.analyzeHeaderCandidateRow(row, i);

      if (detection.score > bestResult.score) {
        bestResult = {
          ...detection,
          rawHeaderText: row.join(' | '),
        };
      }

      if (detection.score >= 0.8) {
        break;
      }
    }

    return bestResult;
  }

  /**
   * Analyze a row to determine if it's a header
   * Utilise un scoring pondéré avec bonus pour combinaisons "table-like"
   */
  private analyzeHeaderCandidateRow(cells: string[], lineIndex: number): HeaderDetection {
    const columns: DetectedColumn[] = [];
    let weightedScore = 0;
    const matchedTypes = new Set<ColumnType>();

    for (let colIdx = 0; colIdx < cells.length; colIdx++) {
      const cell = cells[colIdx];
      if (!cell || typeof cell !== 'string') continue;

      const cellNormalized = this.normalizeText(cell);
      let bestMatch: { type: ColumnType; score: number } | null = null;

      // Try to match against all column types
      for (const [colType, keywords] of Object.entries(COLUMN_DICTIONARY)) {
        if (colType === 'unknown' || keywords.length === 0) continue;

        for (const keyword of keywords) {
          const keywordNorm = this.normalizeText(keyword);
          const score = this.fuzzyMatch(cellNormalized, keywordNorm);

          if (score >= this.config.fuzzyMatchThreshold) {
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { type: colType as ColumnType, score };
            }
          }
        }
      }

      if (bestMatch) {
        columns.push({
          type: bestMatch.type,
          headerText: cell,
          score: bestMatch.score,
          columnIndex: colIdx,
        });
        // Score pondéré par le poids de la colonne
        const weight = COLUMN_WEIGHTS[bestMatch.type] || 1;
        weightedScore += weight * bestMatch.score;
        matchedTypes.add(bestMatch.type);
      } else {
        columns.push({
          type: 'unknown',
          headerText: cell,
          score: 0,
          columnIndex: colIdx,
        });
      }
    }

    // Bonus pour combinaisons "table-like"
    const hasLineNo = matchedTypes.has('lineNo');
    const hasQty = matchedTypes.has('qty');
    const hasUom = matchedTypes.has('uom');
    const hasDescription = matchedTypes.has('description');
    const hasItemCode = matchedTypes.has('itemCode');
    const hasPartNumber = matchedTypes.has('partNumber');

    // Bonus: line + qty = signal fort de tableau
    if (hasLineNo && hasQty) weightedScore += 3;
    // Bonus: qty + uom = signal de tableau
    if (hasQty && hasUom) weightedScore += 2;
    // Bonus: description + (line ou qty) = très probable tableau
    if (hasDescription && (hasLineNo || hasQty)) weightedScore += 2;
    // Bonus: itemCode ou partNumber présent
    if (hasItemCode || hasPartNumber) weightedScore += 1;

    // Le header doit contenir au moins description OU (qty + une autre colonne clé)
    const isValidHeader = hasDescription || (hasQty && matchedTypes.size >= 2);

    return {
      found: weightedScore >= this.config.minHeaderScore && isValidHeader,
      score: weightedScore,
      lineIndex,
      columns,
      rawHeaderText: '',
    };
  }

  /**
   * Extract items using X/Y positions (PDF tokens)
   */
  private extractWithPositions(
    tokens: TextToken[],
    header: HeaderDetection
  ): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];

    // Group tokens by Y position (line)
    const lineGroups = new Map<number, TextToken[]>();
    for (const token of tokens) {
      // Round Y to handle minor variations
      const roundedY = Math.round(token.y / 5) * 5;
      if (!lineGroups.has(roundedY)) {
        lineGroups.set(roundedY, []);
      }
      lineGroups.get(roundedY)!.push(token);
    }

    // Sort lines by Y position
    const sortedYs = Array.from(lineGroups.keys()).sort((a, b) => a - b);

    // Define column boundaries from header if available
    const columnBounds: Map<ColumnType, { xStart: number; xEnd: number }> = new Map();

    if (header.found && header.columns.length > 0) {
      // Use header to define column boundaries
      // For now, use simple column index mapping
      // In a more sophisticated implementation, we'd use X positions from header tokens
    }

    // Process each line
    for (const y of sortedYs) {
      const lineTokens = lineGroups.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = lineTokens.map(t => t.text).join(' ');

      // Try to parse as item line
      const item = this.parseItemLine(lineText, header);
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Extract items from tables (Excel/Word)
   */
  private extractFromTables(
    tables: string[][][],
    header: HeaderDetection
  ): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];

    for (const table of tables) {
      const startRow = header.found ? header.lineIndex + 1 : 0;

      for (let rowIdx = startRow; rowIdx < table.length; rowIdx++) {
        const row = table[rowIdx];
        if (!row || row.length === 0) continue;

        const item = this.extractItemFromRow(row, header.columns);
        if (item) {
          items.push(item);
        }
      }
    }

    return items;
  }

  /**
   * Extract items from parsed rows
   */
  private extractFromRows(
    rows: ParsedRow[],
    header: HeaderDetection
  ): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    const startRow = header.found ? header.lineIndex + 1 : 0;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];

      // Skip empty or continuation rows
      if (!row.raw.trim() || row.isContinuation) continue;

      const cells = row.cells.length > 0 ? row.cells : this.splitRowIntoCells(row.raw);
      const item = this.extractItemFromRow(cells, header.columns);

      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Extract items from raw text (fallback)
   */
  private extractFromRawText(text: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 5) continue;

      const item = this.parseItemLine(trimmed, { found: false, score: 0, lineIndex: -1, columns: [], rawHeaderText: '' });
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Extract a single item from a row of cells
   */
  private extractItemFromRow(
    cells: string[],
    columns: DetectedColumn[]
  ): PriceRequestItem | null {
    const getValue = (type: ColumnType): string | undefined => {
      const col = columns.find(c => c.type === type);
      if (col && col.columnIndex !== undefined && col.columnIndex < cells.length) {
        const val = cells[col.columnIndex];
        return val ? String(val).trim() : undefined;
      }
      return undefined;
    };

    // Get description (required)
    let description = getValue('description');
    if (!description) {
      // Try to find the longest text cell as description
      let maxLen = 0;
      for (const cell of cells) {
        if (cell && String(cell).length > maxLen && !/^\d+([.,]\d+)?$/.test(String(cell))) {
          maxLen = String(cell).length;
          description = String(cell).trim();
        }
      }
    }

    if (!description || description.length < 3) {
      return null;
    }

    // Get quantity
    let quantity = 1;
    const qtyStr = getValue('qty');
    if (qtyStr) {
      const parsed = parseFloat(qtyStr.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100000) {
        quantity = parsed;
      }
    }

    // Build item
    const item: PriceRequestItem = {
      description,
      quantity,
      unit: getValue('uom') || 'pcs',
    };

    // Optional fields
    const code = getValue('itemCode');
    if (code) item.internalCode = code;

    const partNumber = getValue('partNumber');
    if (partNumber) {
      item.supplierCode = partNumber;
      item.reference = partNumber;
    } else if (code) {
      item.reference = code;
    }

    const brand = getValue('brand');
    if (brand) item.brand = brand;

    const lineNo = getValue('lineNo');
    if (lineNo) {
      const parsed = parseInt(lineNo, 10);
      if (!isNaN(parsed)) item.originalLine = parsed;
    }

    const remark = getValue('remark');
    if (remark) item.notes = remark;

    const serial = getValue('serial');
    if (serial) item.serialNumber = serial;

    return item;
  }

  /**
   * Parse a single text line as an item
   */
  private parseItemLine(
    line: string,
    header: HeaderDetection
  ): PriceRequestItem | null {
    // Skip obvious non-item lines
    if (this.isMetadataLine(line)) return null;

    // Try various patterns
    const patterns = [
      // Pattern: Line Qty UOM Code Description
      /^(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+(.+)/i,
      // Pattern: Qty x Description
      /^(\d+)\s*[xX×]\s+(.{10,})/,
      // Pattern: Code - Description - Qty
      /^([A-Z0-9][\w\-]+)\s*[-–:]\s*(.{10,}?)\s*[-–:]\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return this.parsePatternMatch(match, pattern);
      }
    }

    return null;
  }

  /**
   * Parse a regex match into an item
   */
  private parsePatternMatch(
    match: RegExpMatchArray,
    pattern: RegExp
  ): PriceRequestItem | null {
    const source = pattern.source;

    // Pattern: Line Qty UOM Code Description
    if (source.includes('\\d{5,8}')) {
      const qty = parseInt(match[2], 10);
      if (qty <= 0 || qty > 100000) return null;

      return {
        originalLine: parseInt(match[1], 10),
        quantity: qty,
        unit: match[3].toLowerCase() === 'ea' ? 'pcs' : match[3].toLowerCase(),
        internalCode: match[4],
        reference: match[4],
        description: match[5].trim(),
      };
    }

    // Pattern: Qty x Description
    if (source.includes('[xX×]')) {
      const qty = parseInt(match[1], 10);
      if (qty <= 0 || qty > 100000) return null;

      return {
        quantity: qty,
        description: match[2].trim(),
        unit: 'pcs',
      };
    }

    // Pattern: Code - Description - Qty
    if (source.includes('A-Z0-9')) {
      return {
        reference: match[1].trim(),
        description: match[2].trim(),
        quantity: parseInt(match[3], 10) || 1,
        unit: 'pcs',
      };
    }

    return null;
  }

  /**
   * Post-process extracted items
   * - Fusionne les lignes de continuation
   * - Extrait brand et model
   * - Déduplique
   */
  private postProcessItems(
    items: PriceRequestItem[],
    warnings: string[]
  ): PriceRequestItem[] {
    const processed: PriceRequestItem[] = [];
    const seenKeys = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Clean description
      item.description = this.cleanDescription(item.description);

      // Skip invalid items
      if (!item.description || item.description.length < 3) {
        continue;
      }

      // Merge continuation lines if enabled
      if (this.config.mergeMultilineDescriptions && i < items.length - 1) {
        const next = items[i + 1];
        if (this.isContinuationLine(next, item)) {
          // Fusionner description/spec/remark
          item.description += ' ' + next.description;
          if (next.notes) {
            item.notes = item.notes ? `${item.notes} ${next.notes}` : next.notes;
          }
          items.splice(i + 1, 1);
          i--; // Re-check current item
          continue;
        }
      }

      // Deduplicate
      const key = `${item.description.toLowerCase()}-${item.quantity}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      // Extract brand if not already set
      if (!item.brand) {
        item.brand = this.extractBrand(item.description);
      }

      // Extract model number from description (stocké dans notes pour l'instant)
      const model = this.extractModel(item.description);
      if (model && !item.notes?.includes(model)) {
        item.notes = item.notes
          ? `${item.notes} | Model: ${model}`
          : `Model: ${model}`;
      }

      // Extract supplier code if not already set
      if (!item.supplierCode && !item.reference) {
        item.supplierCode = this.extractSupplierCode(item.description);
        if (item.supplierCode) {
          item.reference = item.supplierCode;
        }
      }

      processed.push(item);
    }

    return processed;
  }

  /**
   * Check if a line is metadata (not an item)
   */
  private isMetadataLine(line: string): boolean {
    const metadataPatterns = [
      /^(From|To|Cc|Bcc|Subject|Sent|Date|Re:|Fwd:|De:|À:|Objet:)\s*:/i,
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
      /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)/i,
      /\b(Capital\s+social|RCCM|RC\s*:|NIF|SIRET|SIREN)\b/i,
      /\bTEL\/FAX\s*:/i,
      /^(Total|Grand Total|Sous-total|Subtotal)\b/i,
      /^(Page\s+\d+|---+|\*\*\*+)$/i,
    ];

    return metadataPatterns.some(p => p.test(line));
  }

  /**
   * Check if an item is a continuation of the previous line
   * Amélioré avec plus de critères pour éviter les faux positifs
   */
  private isContinuationLine(item: PriceRequestItem, prevItem?: PriceRequestItem): boolean {
    // Critères de base: pas de qty significative, pas de référence
    const hasNoStructure = (
      item.quantity === 1 &&
      !item.reference &&
      !item.internalCode &&
      !item.supplierCode &&
      item.description.length > 0
    );

    if (!hasNoStructure) return false;

    const desc = item.description;

    // Pas de numéro de ligne au début
    if (/^\d{1,3}\s/.test(desc)) return false;

    // Pas de mot-clé qty/uom au début
    if (/^(qty|quantity|qté|quantité|ea|pcs|pc|set|lot|kg|m|l)\b/i.test(desc)) return false;

    // Si la description commence par une minuscule, c'est probablement une continuation
    if (/^[a-z]/.test(desc)) return true;

    // Si la description précédente se termine par un caractère de continuation
    if (prevItem && /[,;:\-]$/.test(prevItem.description)) return true;

    // Si la ligne est relativement courte (< 100 chars) et ne ressemble pas à un item
    if (desc.length < 100) {
      // Pas de pattern typique de nouvelle ligne item (code - desc, qty x desc)
      if (!/^[A-Z0-9]{2,}[\s\-]/.test(desc) && !/^\d+\s*[xX×]/.test(desc)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clean a description string
   */
  private cleanDescription(desc: string): string {
    return desc
      .replace(/\s+(USD|EUR|XOF)\s*/gi, ' ')
      .replace(/\s+\d+\s+(USD|EUR|XOF)/gi, '')
      .replace(/\s+1500\d+.*$/i, '')
      .replace(/\s+0\s+0\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Extract brand from description using dynamic brand list loaded from JSON
   * Utilise une recherche par mot entier pour éviter les faux positifs
   */
  private extractBrand(description: string): string | undefined {
    const upper = description.toUpperCase();

    // Ensure brands are loaded
    if (this.knownBrands.length === 0) {
      this.knownBrands = FALLBACK_BRANDS;
    }

    // Sort brands by length (longest first) to match "SCHNEIDER ELECTRIC" before "SCHNEIDER"
    const sortedBrands = [...this.knownBrands].sort((a, b) => b.length - a.length);

    for (const brand of sortedBrands) {
      // Regex pour mot entier (évite de matcher "CAT" dans "CATEGORY")
      const regex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(upper)) {
        // Normaliser certaines variantes
        if (brand === 'CAT') return 'CATERPILLAR';
        if (brand === 'BOSCH REXROTH') return 'REXROTH';
        if (brand === 'SAUER DANFOSS') return 'DANFOSS';
        return brand;
      }
    }
    return undefined;
  }

  /**
   * Extract model number from description
   * Patterns courants: WA470, LRD325, 6205-2RS, etc.
   */
  private extractModel(description: string): string | undefined {
    const patterns = [
      // Pattern: Lettres + chiffres (WA470, LRD325, PC200)
      /\b([A-Z]{1,4}\d{2,5}[A-Z]?(?:-\d+)?)\b/i,
      // Pattern: Chiffres + tiret + alphanum (6205-2RS, 22220-E1)
      /\b(\d{4,6}[-/][A-Z0-9]{1,4})\b/i,
      // Pattern: Série avec tiret (WA-470, PC-200)
      /\b([A-Z]{2,3}-\d{2,4})\b/i,
      // Pattern: Modèle avec slash (710/0321)
      /\b(\d{3,4}\/\d{3,5})\b/,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        const model = match[1];
        // Vérifier que ce n'est pas juste un numéro d'article
        if (model.length >= 4 && !/^\d+$/.test(model)) {
          return model.toUpperCase();
        }
      }
    }
    return undefined;
  }

  /**
   * Extract supplier code from description
   */
  private extractSupplierCode(description: string): string | undefined {
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

  /**
   * Split a row into cells using common delimiters
   */
  private splitRowIntoCells(row: string): string[] {
    // Try tab first
    if (row.includes('\t')) {
      return row.split('\t').map(c => c.trim());
    }

    // Try semicolon
    if (row.includes(';')) {
      return row.split(';').map(c => c.trim());
    }

    // Try multiple spaces (3+)
    const spaceSplit = row.split(/\s{3,}/);
    if (spaceSplit.length > 2) {
      return spaceSplit.map(c => c.trim());
    }

    // Return as single cell
    return [row.trim()];
  }

  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9\s]/g, '')     // Remove punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Simple fuzzy match using Levenshtein-like comparison
   */
  private fuzzyMatch(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    // Check if one contains the other
    if (a.includes(b) || b.includes(a)) {
      const longer = Math.max(a.length, b.length);
      const shorter = Math.min(a.length, b.length);
      return shorter / longer;
    }

    // Simple character-based similarity
    const aSet = new Set(a.split(''));
    const bSet = new Set(b.split(''));
    const intersection = new Set([...aSet].filter(c => bSet.has(c)));
    const union = new Set([...aSet, ...bSet]);

    return intersection.size / union.size;
  }
}
