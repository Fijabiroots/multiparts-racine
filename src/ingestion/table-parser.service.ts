import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ColumnType,
  DetectedColumn,
  COLUMN_DICTIONARY,
  COLUMN_WEIGHTS,
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
 * Header detection result
 */
export interface HeaderDetection {
  found: boolean;
  score: number;
  lineIndex: number;
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
  extractionMethod: 'header-based' | 'heuristic';
  mergedContinuationLines?: number;
}

/**
 * Configuration for table parsing
 */
export interface TableParserConfig {
  minHeaderScore?: number;
  maxHeaderSearchLines?: number;
}

// ============================================================================
// COLONNES ESSENTIELLES À EXTRAIRE (mapping vers PriceRequestItem)
// ============================================================================

// Ces types seront mappés vers les champs de PriceRequestItem
const ESSENTIAL_COLUMN_TYPES: ColumnType[] = [
  'qty',           // -> quantity
  'uom',           // -> unit
  'itemCode',      // -> internalCode, reference
  'partNumber',    // -> supplierCode, reference
  'brand',         // -> brand
  'description',   // -> description
  'remark',        // -> notes
  'specification', // -> append to description or notes
  'lineNo',        // -> originalLine
];

// Minimum score pour considérer une ligne comme en-tête
const MIN_HEADER_SCORE = 8;

// Lignes maximum à scanner pour trouver l'en-tête
const MAX_HEADER_SEARCH_LINES = 40;

// ============================================================================
// PATTERNS DE BRUIT À IGNORER
// ============================================================================

const NOISE_PATTERNS = [
  // En-têtes d'email
  /^(From|To|Cc|Bcc|Subject|Sent|Date|Re:|Fwd:|De:|À:|Objet:)\s*:/i,
  // Informations légales/société
  /\b(Capital\s+social|RCCM|RC\s*:|NIF|SIRET|SIREN)\b/i,
  /\bTEL\/FAX\s*:/i,
  // Totaux et pieds de page
  /^(Total|Grand Total|Sous-total|Subtotal)\s*:?\s*$/i,
  /\b(Total\s+in\s+Equivalent|Total\s+Cost|Net\s+Total)\b/i,
  // Pagination/Séparateurs
  /^(Page\s+\d+\s*(of|\/|sur)\s*\d+|---+|\*\*\*+|===+)$/i,
  // Signatures email
  /^(Cordialement|Best regards|Regards|Sincères salutations|Kind regards)/i,
  /^(Sent from|Envoyé depuis)/i,
  // Labels de Purchase Requisition (métadonnées) - match avec ou sans contenu après
  /^(Purchase\s+Requisitions?\s+No|Requisition\s+No|PR\s+Number)\s*:?/i,
  /^(Creation\s+Date|Required\s+Date|Delivery\s+Date)\s*[\(\):]/i,
  /\bDelivery\s+Date\(s\)\s*:/i,
  /^(General\s+Description|Additional\s+Description|Item\s+Description)\s*:/i,
  /^(Requestor|Requester|HOD\s+name|Buyer|Approver)\s*:?\s*$/i,
  /^(Activity\s+Code|GL\s+Code|Cost\s+Center|Sub\s+Activity)\s*:?\s*$/i,
  /^(Recommended\s+supplier|Preferred\s+supplier)\s*:?\s*$/i,
  // Metadata labels (mots courts génériques)
  /^(New\s+stock\s+item|Sole\s+supplier|Short\s+motivation|Additional|Signature)\s*,?\s*$/i,
  /^(RECOMMENDED|ADDITIONAL|SIGNATURE|REQUISITION|REVISION)\s*$/i,
  /^name\s*&?\s*$/i,
  /^(ARO|OOD)\s+(for|FOR)\s*$/i,  // Labels ARO/OOD sans description
  // En-têtes de tableau (colonnes combinées)
  /^Line\s+Quantity\s+UOM/i,
  /^(Line|Qty|Quantity|UOM|Item\s+Code|Part\s+Number|Description|Stock)\s*$/i,
  // Noms de personnes (pattern: Prénom NOM ou NOM Prénom)
  /^[A-Z][a-z]+\s+[A-Z]{2,}$/,  // Jean DUPONT
  /^[A-Z]{2,}\s+[A-Z][a-z]+$/,  // DUPONT Jean
  // Dates standalone
  /^\d{1,2}[-\/](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\/]\d{2,4}$/i,
  /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/,
  // Codes seuls sans contexte
  /^SUB-$/i,
  /^OFF$/i,
  // === SIGNATURE EMAIL ===
  // Emails
  /^[\w\.\-]+@[\w\.\-]+\.\w+$/i,
  /\b[\w\.\-]+@[\w\.\-]+\.(com|org|net|ci|fr|io)\b/i,
  // Téléphones (formats internationaux)
  /^[\*\+]?\d{3}[\s\.\-]?\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}$/,
  /^\+?\d{1,4}[\s\.\-]?\d{2,3}[\s\.\-]?\d{2,3}[\s\.\-]?\d{2,3}[\s\.\-]?\d{2,3}$/,
  /^\*\+\d{3}/,  // Pattern *+225...
  // URLs et sites web
  /^(https?:\/\/|www\.)/i,
  /\bwww\.\w+\.\w+/i,
  /<https?:\/\//i,
  // Adresses postales
  /\b\d+,?\s+(Avenue|Rue|Boulevard|Street|Road|Place)\b/i,
  /\b(Abidjan|Paris|London|Accra|Dakar|Lagos)\b.*\b(Côte d'Ivoire|France|Ghana|Senegal|Nigeria)?\b/i,
  /\bBP\s+\d+\b/i,  // Boîte postale
  // Numéros de téléphone avec préfixes
  /^(Tel|Tél|Phone|Fax|Mobile|Cell)\s*[:.]?\s*[\+\d]/i,
];

const BRANDS_FILE_PATH = path.join(process.cwd(), 'data', 'brands_grouped_by_category.json');

const FALLBACK_BRANDS = [
  'CATERPILLAR', 'CAT', 'KOMATSU', 'HITACHI', 'VOLVO', 'LIEBHERR', 'SANDVIK',
  'SKF', 'FAG', 'NSK', 'NTN', 'TIMKEN', 'SIEMENS', 'ABB', 'SCHNEIDER',
  'PARKER', 'REXROTH', 'BOSCH', 'FESTO', 'EATON', 'CUMMINS', 'PERKINS',
  'DONALDSON', 'MANN', 'FLEETGUARD', 'GATES', 'FLUKE', 'MICHELIN', 'BRIDGESTONE',
];

/**
 * TableParserService - Utilise COLUMN_DICTIONARY complet
 *
 * Extrait les champs essentiels:
 * - Référence (itemCode/partNumber -> supplierCode)
 * - Désignation (description)
 * - Marque (brand)
 * - Quantité (qty)
 * - Unité (uom)
 * - Notes (remark/specification)
 */
@Injectable()
export class TableParserService implements OnModuleInit {
  private readonly logger = new Logger(TableParserService.name);
  private knownBrands: string[] = [];
  private brandsLastLoaded: Date | null = null;

  async onModuleInit(): Promise<void> {
    await this.loadBrandsFromFile();
  }

  async loadBrandsFromFile(): Promise<void> {
    try {
      if (!fs.existsSync(BRANDS_FILE_PATH)) {
        this.knownBrands = FALLBACK_BRANDS;
        return;
      }

      const fileContent = fs.readFileSync(BRANDS_FILE_PATH, 'utf-8');
      const data: BrandsFile = JSON.parse(fileContent);

      const allBrands = new Set<string>();
      for (const category of data.categories) {
        for (const brand of category.brands) {
          allBrands.add(brand.toUpperCase().trim());
        }
      }

      this.knownBrands = Array.from(allBrands);
      this.brandsLastLoaded = new Date();
      this.logger.log(`Loaded ${this.knownBrands.length} brands`);
    } catch (error) {
      this.logger.error(`Failed to load brands: ${error.message}`);
      this.knownBrands = FALLBACK_BRANDS;
    }
  }

  getKnownBrands(): string[] {
    return [...this.knownBrands];
  }

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

  configure(config: Partial<TableParserConfig>): void {
    // Placeholder for configuration
  }

  /**
   * Parse un document normalisé et extrait les items
   */
  parseDocument(doc: NormalizedDocument): TableExtractionResult {
    const warnings: string[] = [];

    // 1. Détecter l'en-tête
    const headerDetection = this.detectHeader(doc);

    if (!headerDetection.found) {
      warnings.push('No header row detected - using heuristic parsing');
      this.logger.warn(`No header found for ${doc.sourceName}`);
    } else {
      this.logger.debug(
        `Header at line ${headerDetection.lineIndex}, score ${headerDetection.score}, columns: ${headerDetection.columns.map(c => c.type).join(', ')}`
      );
    }

    // 2. Extraire les items
    let items: PriceRequestItem[] = [];
    let mergedContinuationLines = 0;

    if (doc.tables && doc.tables.length > 0) {
      items = this.extractFromTables(doc.tables, headerDetection);
    } else if (doc.rows && doc.rows.length > 0) {
      const result = this.extractFromRows(doc.rows, headerDetection);
      items = result.items;
      mergedContinuationLines = result.mergedContinuationLines;
    } else if (doc.rawText) {
      const result = this.extractFromRawText(doc.rawText, headerDetection);
      items = result.items;
      mergedContinuationLines = result.mergedContinuationLines;
    }

    this.logger.debug(`Extracted ${items.length} raw items from ${doc.sourceName} (${mergedContinuationLines} continuation lines merged)`);

    // 3. Post-traitement: nettoyage et enrichissement
    items = this.postProcessItems(items);

    return {
      items,
      headerDetection,
      warnings,
      extractionMethod: headerDetection.found ? 'header-based' : 'heuristic',
      mergedContinuationLines,
    };
  }

  /**
   * Détecte la ligne d'en-tête dans le document
   * Utilise COLUMN_DICTIONARY complet de types.ts
   */
  detectHeader(doc: NormalizedDocument): HeaderDetection {
    const noHeader: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    // Vérifier les tables d'abord (Excel)
    if (doc.tables && doc.tables.length > 0) {
      for (const table of doc.tables) {
        const result = this.detectHeaderInTable(table);
        if (result.found) return result;
      }
    }

    // Vérifier les rows (PDF/texte)
    if (doc.rows && doc.rows.length > 0) {
      return this.detectHeaderInRows(doc.rows);
    }

    // Fallback: texte brut
    if (doc.rawText) {
      const rows = doc.rawText.split('\n').map((line, idx) => ({
        raw: line,
        cells: this.splitIntoCells(line),
        lineNumber: idx,
      }));
      return this.detectHeaderInRows(rows);
    }

    return noHeader;
  }

  /**
   * Détecte l'en-tête dans un tableau 2D
   */
  private detectHeaderInTable(table: string[][]): HeaderDetection {
    const maxSearch = Math.min(table.length, MAX_HEADER_SEARCH_LINES);
    let bestResult: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    for (let i = 0; i < maxSearch; i++) {
      const row = table[i];
      if (!row || row.length < 2) continue;

      const detection = this.analyzeHeaderRow(row, i);

      if (detection.score > bestResult.score) {
        bestResult = {
          ...detection,
          rawHeaderText: row.join(' | '),
        };
      }

      if (detection.found && detection.score >= MIN_HEADER_SCORE) {
        break;
      }
    }

    return bestResult;
  }

  /**
   * Détecte l'en-tête dans des lignes parsées
   */
  private detectHeaderInRows(rows: ParsedRow[]): HeaderDetection {
    const maxSearch = Math.min(rows.length, MAX_HEADER_SEARCH_LINES);
    let bestResult: HeaderDetection = {
      found: false,
      score: 0,
      lineIndex: -1,
      columns: [],
      rawHeaderText: '',
    };

    for (let i = 0; i < maxSearch; i++) {
      const row = rows[i];
      if (!row.raw.trim()) continue;

      const cells = row.cells.length > 1 ? row.cells : this.splitIntoCells(row.raw);
      if (cells.length < 2) continue;

      const detection = this.analyzeHeaderRow(cells, i);

      if (detection.score > bestResult.score) {
        bestResult = {
          ...detection,
          rawHeaderText: row.raw,
        };
      }

      if (detection.found && detection.score >= MIN_HEADER_SCORE) {
        break;
      }
    }

    return bestResult;
  }

  /**
   * Analyse une ligne pour déterminer si c'est un en-tête
   * Utilise COLUMN_DICTIONARY complet
   */
  private analyzeHeaderRow(cells: string[], lineIndex: number): HeaderDetection {
    const columns: DetectedColumn[] = [];
    let totalScore = 0;
    const foundTypes = new Set<ColumnType>();

    for (let colIdx = 0; colIdx < cells.length; colIdx++) {
      const cell = cells[colIdx];
      if (!cell || typeof cell !== 'string') continue;

      const normalized = this.normalizeText(cell);
      if (normalized.length < 2) continue;

      let bestMatch: { type: ColumnType; score: number } | null = null;

      // Chercher dans COLUMN_DICTIONARY complet
      for (const [colType, keywords] of Object.entries(COLUMN_DICTIONARY)) {
        if (colType === 'unknown' || !keywords || keywords.length === 0) continue;

        for (const keyword of keywords) {
          const keywordNorm = this.normalizeText(keyword);
          if (!keywordNorm) continue;

          // Match exact ou contenu
          let score = 0;
          if (normalized === keywordNorm) {
            score = 1.0;
          } else if (normalized.includes(keywordNorm) || keywordNorm.includes(normalized)) {
            score = 0.8;
          }

          if (score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { type: colType as ColumnType, score };
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
        const weight = COLUMN_WEIGHTS[bestMatch.type] || 1;
        totalScore += weight * bestMatch.score;
        foundTypes.add(bestMatch.type);
      }
    }

    // L'en-tête DOIT contenir description ET (qty OU itemCode/partNumber)
    const hasDescription = foundTypes.has('description');
    const hasQty = foundTypes.has('qty');
    const hasCode = foundTypes.has('itemCode') || foundTypes.has('partNumber');
    const isValidHeader = hasDescription && (hasQty || hasCode);

    // Bonus si on a la combo description + qty
    if (hasDescription && hasQty) {
      totalScore += 3;
    }

    return {
      found: isValidHeader && totalScore >= MIN_HEADER_SCORE,
      score: totalScore,
      lineIndex,
      columns,
      rawHeaderText: '',
    };
  }

  /**
   * Extrait les items depuis des tables (Excel)
   */
  private extractFromTables(tables: string[][][], header: HeaderDetection): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];

    for (const table of tables) {
      const startRow = header.found ? header.lineIndex + 1 : 1;

      for (let rowIdx = startRow; rowIdx < table.length; rowIdx++) {
        const row = table[rowIdx];
        if (!row || row.length < 2) continue;

        const rowText = row.join(' ');
        if (this.isNoiseLine(rowText)) continue;
        if (this.isEmptyDataRow(row)) continue;

        const item = this.extractItemFromCells(row, header.columns, rowIdx);
        if (item) {
          items.push(item);
        }
      }
    }

    return items;
  }

  /**
   * Extrait les items depuis des lignes parsées
   * Implémente le merge des lignes de continuation (descriptions multilignes)
   */
  private extractFromRows(rows: ParsedRow[], header: HeaderDetection): { items: PriceRequestItem[]; mergedContinuationLines: number } {
    const items: PriceRequestItem[] = [];
    const startRow = header.found ? header.lineIndex + 1 : 0;
    let mergedContinuationLines = 0;
    let lastItem: PriceRequestItem | null = null;

    this.logger.debug(`Extracting from rows starting at ${startRow}, total rows: ${rows.length}`);

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row.raw.trim()) continue;

      if (this.isNoiseLine(row.raw)) continue;

      const cells = row.cells.length > 1 ? row.cells : this.splitIntoCells(row.raw);

      // Check if this is a continuation line (no qty, no code, just text)
      if (lastItem && this.isContinuationRow(cells, row.raw)) {
        // Merge with previous item
        const continuationText = this.extractContinuationText(cells, row.raw);
        if (continuationText) {
          lastItem.description = (lastItem.description + ' ' + continuationText).trim();
          if (!lastItem.notes) {
            lastItem.notes = '';
          }
          lastItem.notes = (lastItem.notes + '\n[+] ' + continuationText).trim();
          mergedContinuationLines++;
          this.logger.debug(`Merged continuation line ${i}: "${continuationText.substring(0, 50)}..."`);
          continue;
        }
      }

      if (this.isEmptyDataRow(cells)) continue;

      const item = this.extractItemFromCells(cells, header.columns, i);
      if (item) {
        items.push(item);
        lastItem = item;
      }
    }

    return { items, mergedContinuationLines };
  }

  /**
   * Check if a row is a continuation of the previous item (multiline description)
   * A continuation row typically has:
   * - No quantity
   * - No item code/part number
   * - Contains meaningful text (>= 8 chars)
   */
  private isContinuationRow(cells: string[], raw: string): boolean {
    // Must have some meaningful text
    const cleanRaw = raw.trim();
    if (cleanRaw.length < 8) return false;

    // Check if row has a quantity
    if (this.rowHasQuantity(cells)) return false;

    // Check if row has an item/part code
    if (this.rowHasCode(cells)) return false;

    // Check if it looks like a new item line (starts with line number)
    if (/^\d{1,3}\s+/.test(cleanRaw)) return false;

    // Check if it contains significant descriptive text
    const significantWords = cleanRaw.split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
    if (significantWords.length < 1) return false;

    // Not a table header
    const headerKeywords = ['line', 'qty', 'quantity', 'uom', 'item', 'code', 'description', 'stock'];
    const lowerRaw = cleanRaw.toLowerCase();
    const matchedHeaders = headerKeywords.filter(h => lowerRaw.includes(h));
    if (matchedHeaders.length >= 2) return false;

    return true;
  }

  /**
   * Check if row contains a quantity value
   */
  private rowHasQuantity(cells: string[]): boolean {
    const QTY_PATTERN = /^\d{1,4}([.,]\d+)?$/;

    for (const cell of cells) {
      const s = String(cell || '').trim();
      if (QTY_PATTERN.test(s)) {
        const num = parseFloat(s.replace(',', '.'));
        if (num > 0 && num <= 9999) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if row contains an item/part code
   */
  private rowHasCode(cells: string[]): boolean {
    const CODE_PATTERN = /^[A-Z0-9][\w\-\/\.]{4,}$/i;
    const INTERNAL_CODE_PATTERN = /^\d{5,8}$/;

    for (const cell of cells) {
      const s = String(cell || '').trim();
      // Item code (alphanumeric, 5+ chars, mixed letters/numbers)
      if (CODE_PATTERN.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s)) {
        return true;
      }
      // Internal code (5-8 digits)
      if (INTERNAL_CODE_PATTERN.test(s) && !s.startsWith('1500')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract the continuation text from a row
   */
  private extractContinuationText(cells: string[], raw: string): string | null {
    // Join all non-empty cells
    const nonEmpty = cells.filter(c => String(c || '').trim().length > 0);
    if (nonEmpty.length > 0) {
      return nonEmpty.join(' ').trim();
    }
    return raw.trim() || null;
  }

  /**
   * Extrait les items depuis du texte brut
   */
  private extractFromRawText(text: string, header: HeaderDetection): { items: PriceRequestItem[]; mergedContinuationLines: number } {
    const lines = text.split('\n');
    const rows: ParsedRow[] = lines.map((line, idx) => ({
      raw: line,
      cells: this.splitIntoCells(line),
      lineNumber: idx,
    }));
    return this.extractFromRows(rows, header);
  }

  /**
   * Vérifie si une ligne de données est vide (tous les champs vides ou numériques sans sens)
   */
  private isEmptyDataRow(cells: string[]): boolean {
    const nonEmptyCells = cells.filter(c => c && String(c).trim().length > 0);
    if (nonEmptyCells.length < 2) return true;

    // Vérifier s'il y a au moins une cellule avec du texte significatif
    const hasText = cells.some(c => {
      const s = String(c || '').trim();
      return s.length >= 3 && !/^[\d\s\.\,\-\/]+$/.test(s);
    });

    return !hasText;
  }

  /**
   * Extrait un item depuis des cellules
   * Utilise TOUJOURS l'extraction heuristique car les PDF ont des colonnes mal alignées
   */
  private extractItemFromCells(cells: string[], columns: DetectedColumn[], rowIndex: number): PriceRequestItem | null {
    // Pour les PDF, les colonnes détectées ne correspondent souvent pas aux indices des cellules
    // On utilise donc une extraction heuristique qui analyse chaque cellule
    return this.extractHeuristic(cells, rowIndex);
  }

  /**
   * Extraction heuristique - analyse chaque cellule pour deviner son type
   * C'est la méthode la plus robuste pour les PDF mal structurés
   */
  private extractHeuristic(cells: string[], rowIndex: number): PriceRequestItem | null {
    if (cells.length < 1) return null;

    // Si une seule cellule ou deux, essayer de re-splitter
    let workingCells = cells;
    if (cells.length <= 2) {
      const combined = cells.join(' ').trim();
      // Essayer de splitter avec différents patterns
      const reSplit = this.smartSplitLine(combined);
      if (reSplit.length > cells.length) {
        workingCells = reSplit;
      }
    }

    let description: string | undefined;
    let quantity = 1;
    let unit = 'pcs';
    let reference: string | undefined;
    let brand: string | undefined;
    let internalCode: string | undefined;

    // Patterns pour identifier les types de données
    const QTY_PATTERN = /^\d{1,4}([.,]\d+)?$/;  // Nombre 1-4 chiffres
    const UNIT_PATTERNS = ['EA', 'PCS', 'PC', 'UNIT', 'SET', 'KG', 'M', 'L', 'BOX', 'EACH', 'PAIR', 'LOT', 'ROLL', 'LTR', 'MTR', 'OFF'];
    const CODE_PATTERN = /^[A-Z0-9][\w\-\/\.]{2,}$/i;  // Code alphanumérique 3+ chars
    const INTERNAL_CODE_PATTERN = /^\d{5,8}$/; // Code interne 5-8 chiffres (ex: 201368)

    // Première passe: identifier qty, unit, codes internes et références
    for (let i = 0; i < workingCells.length; i++) {
      const cell = String(workingCells[i] || '').trim();
      if (!cell) continue;

      const cellUpper = cell.toUpperCase();

      // Quantité (nombre seul, 1-4 chiffres)
      if (QTY_PATTERN.test(cell) && quantity === 1) {
        const num = parseFloat(cell.replace(',', '.'));
        if (num > 0 && num <= 9999) {
          quantity = num;
          continue;
        }
      }

      // Unité
      if (UNIT_PATTERNS.includes(cellUpper) || /^(EA|PCS?|PC)$/i.test(cell)) {
        unit = cellUpper;
        continue;
      }

      // Code interne (5-8 chiffres, ex: 201368)
      if (INTERNAL_CODE_PATTERN.test(cell) && !internalCode) {
        // Vérifier que ce n'est pas un GL Code (commence par 1500)
        if (!cell.startsWith('1500')) {
          internalCode = cell;
          continue;
        }
      }

      // Code/Référence fournisseur (alphanumérique, 4-25 chars, pas que des chiffres)
      if (CODE_PATTERN.test(cell) && cell.length >= 4 && cell.length <= 25) {
        if (!/^\d+$/.test(cell) && !reference) {
          reference = cell.toUpperCase();
          continue;
        }
      }
    }

    // Deuxième passe: trouver la description (cellule la plus longue avec du texte)
    let maxLen = 0;
    for (const cell of workingCells) {
      const s = String(cell || '').trim();
      // Description: texte de 10+ chars, pas que des chiffres/symboles
      if (s.length >= 10 && s.length > maxLen && !/^[\d\s\.\,\-\/\(\)\[\]]+$/.test(s)) {
        if (!this.isNoiseLine(s)) {
          // Vérifier que ce n'est pas juste un code
          const words = s.split(/\s+/).filter(w => w.length >= 3);
          if (words.length >= 1) {
            maxLen = s.length;
            description = s;
          }
        }
      }
    }

    // Fallback: si pas de description longue, prendre la cellule la plus significative
    if (!description) {
      for (const cell of workingCells) {
        const s = String(cell || '').trim();
        if (s.length >= 5 && s.length > maxLen && !this.isNoiseLine(s)) {
          if (!/^[\d\s\.\,\-\/]+$/.test(s) && !/^\d+$/.test(s)) {
            maxLen = s.length;
            description = s;
          }
        }
      }
    }

    // Si toujours pas de description, essayer d'extraire depuis la ligne brute
    if (!description && cells.length <= 2) {
      const combined = cells.join(' ').trim();
      const extracted = this.extractDescriptionFromLine(combined);
      if (extracted) {
        description = extracted.description;
        if (!quantity || quantity === 1) quantity = extracted.quantity || 1;
        if (!unit || unit === 'pcs') unit = extracted.unit || 'pcs';
        if (!internalCode) internalCode = extracted.internalCode;
        if (!reference) reference = extracted.reference;
      }
    }

    // Pas de description = pas d'item
    if (!description || description.length < 5) {
      return null;
    }

    // Nettoyer la description des codes GL et prix
    description = this.cleanItemDescription(description);

    // Extraire la marque de la description
    brand = this.extractBrand(description);

    // Extraire le code de la description si pas trouvé dans les cellules
    if (!reference) {
      reference = this.extractSupplierCode(description);
    }

    return {
      description: this.cleanDescription(description),
      quantity,
      unit,
      reference: reference || internalCode,
      internalCode,
      supplierCode: reference,
      brand,
      originalLine: rowIndex,
    };
  }

  /**
   * Split intelligent d'une ligne en cellules
   */
  private smartSplitLine(line: string): string[] {
    // Pattern 1: Format Purchase Requisition compact
    // Ex: "10 10 EA 201368 RELAY OVERLOAD THERMAL..."
    const prMatch = line.match(/^(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+(.+)/i);
    if (prMatch) {
      return [prMatch[1], prMatch[2], prMatch[3], prMatch[4], prMatch[5]];
    }

    // Pattern 2: Format sans code interne
    // Ex: "10 3 EA Seat cover Hilux Dual Cab"
    const simpleMatch = line.match(/^(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(.+)/i);
    if (simpleMatch) {
      return [simpleMatch[1], simpleMatch[2], simpleMatch[3], simpleMatch[4]];
    }

    // Pattern 3: Tab séparé
    if (line.includes('\t')) {
      return line.split('\t').map(c => c.trim()).filter(c => c);
    }

    // Pattern 4: Multiple espaces (3+)
    const spaceSplit = line.split(/\s{3,}/);
    if (spaceSplit.length >= 3) {
      return spaceSplit.map(c => c.trim()).filter(c => c);
    }

    // Pattern 5: Détecter les colonnes par patterns de données
    // Ex: "10" "EA" "201368" "DESCRIPTION..."
    const parts = line.split(/\s+/);
    if (parts.length >= 4) {
      const result: string[] = [];
      let descStart = -1;

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        // Nombre 1-4 chiffres (qty/line)
        if (/^\d{1,4}$/.test(p) && result.length < 2) {
          result.push(p);
          continue;
        }
        // Unité
        if (/^(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)$/i.test(p)) {
          result.push(p);
          continue;
        }
        // Code interne 5-8 chiffres
        if (/^\d{5,8}$/.test(p) && !p.startsWith('1500')) {
          result.push(p);
          continue;
        }
        // Le reste est la description
        if (descStart === -1 && /^[A-Z]/i.test(p)) {
          descStart = i;
          break;
        }
      }

      if (descStart > 0) {
        result.push(parts.slice(descStart).join(' '));
        return result;
      }
    }

    // Fallback: retourner le split original par 2+ espaces
    return line.split(/\s{2,}/).map(c => c.trim()).filter(c => c);
  }

  /**
   * Extraire description et données d'une ligne brute
   */
  private extractDescriptionFromLine(line: string): {
    description?: string;
    quantity?: number;
    unit?: string;
    internalCode?: string;
    reference?: string;
  } | null {
    // Pattern Purchase Requisition complet avec GL Code
    // Ex: "10 10 EA 201368 RELAY OVERLOAD THERMAL 17-25A CLASS 10A SCHNEIDER LRD325 1500405 0 0"
    const prFullMatch = line.match(
      /^\d{1,3}\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)\:]+?)(?:\s+1500\d+|\s+\d+\s+\d+\s*(USD|EUR|XOF)?|\s*$)/i
    );
    if (prFullMatch) {
      return {
        quantity: parseInt(prFullMatch[1], 10),
        unit: prFullMatch[2].toUpperCase(),
        internalCode: prFullMatch[3],
        description: prFullMatch[4].trim(),
      };
    }

    // Pattern sans GL Code
    const prSimpleMatch = line.match(
      /^\d{1,3}\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z].+)/i
    );
    if (prSimpleMatch) {
      let desc = prSimpleMatch[4].trim();
      // Nettoyer les codes GL à la fin
      desc = desc.replace(/\s+1500\d+.*$/i, '').trim();
      desc = desc.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
      return {
        quantity: parseInt(prSimpleMatch[1], 10),
        unit: prSimpleMatch[2].toUpperCase(),
        internalCode: prSimpleMatch[3],
        description: desc,
      };
    }

    // Pattern sans code interne
    const simpleMatch = line.match(
      /^\d{1,3}\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+([A-Z].+)/i
    );
    if (simpleMatch) {
      return {
        quantity: parseInt(simpleMatch[1], 10),
        unit: simpleMatch[2].toUpperCase(),
        description: simpleMatch[3].trim(),
      };
    }

    return null;
  }

  /**
   * Nettoyer une description d'item (GL codes, prix, etc.)
   */
  private cleanItemDescription(desc: string): string {
    let cleaned = desc;

    // Supprimer les codes GL (1500xxx) collés ou avec espace
    cleaned = cleaned.replace(/([A-Z]+\d+)1500\d+.*$/i, '$1').trim();
    cleaned = cleaned.replace(/\s*1500\d+.*$/i, '').trim();

    // Supprimer les prix et devises
    cleaned = cleaned.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
    cleaned = cleaned.replace(/\s+0\s+0\s*$/i, '').trim();

    // Normaliser les espaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

    return cleaned;
  }

  /**
   * Post-traitement des items
   */
  private postProcessItems(items: PriceRequestItem[]): PriceRequestItem[] {
    const processed: PriceRequestItem[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      // Nettoyer la description
      item.description = this.cleanDescription(item.description);

      // Skip si description trop courte ou invalide
      if (!item.description || item.description.length < 5) continue;
      if (this.isNoiseLine(item.description)) continue;

      // Extraire la marque si pas déjà définie
      if (!item.brand) {
        item.brand = this.extractBrand(item.description);
      }

      // Extraire le code fournisseur si pas défini
      if (!item.supplierCode && !item.reference) {
        const code = this.extractSupplierCode(item.description);
        if (code) {
          item.supplierCode = code;
          item.reference = code;
        }
      }

      // Déduplication par description + quantité
      const descKey = item.description.toLowerCase().replace(/\s+/g, ' ').substring(0, 60);
      const key = `${descKey}-${item.quantity}`;
      if (seen.has(key)) continue;
      seen.add(key);

      processed.push(item);
    }

    this.logger.debug(`Post-processed: ${items.length} -> ${processed.length} items`);
    return processed;
  }

  /**
   * Vérifie si une ligne est du bruit (à ignorer)
   */
  private isNoiseLine(line: string): boolean {
    const trimmed = line.trim();

    if (trimmed.length < 3) return true;

    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }

    // Ligne qui ne contient que des chiffres/symboles
    if (/^[\d\s\.\,\-\/\(\)\[\]]+$/.test(trimmed)) return true;

    // Labels qui se terminent par ":" (ex: "General Description:", "Purchase Requisitions No:")
    if (/^[A-Za-z\s]+:\s*$/.test(trimmed)) return true;

    // Labels avec valeur courte après ":" (ex: "Creation Date: 10-DEC-25")
    if (/^[A-Za-z\s]+:\s*[\d\-\/A-Z]+$/i.test(trimmed) && trimmed.length < 40) return true;

    // Noms de personnes (2-4 mots, chaque mot commence par majuscule)
    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      const allCapitalized = words.every(w => /^[A-Z][a-zA-Z]*$/.test(w));
      const hasNoNumbers = !/\d/.test(trimmed);
      const shortWords = words.every(w => w.length <= 15);
      if (allCapitalized && hasNoNumbers && shortWords && trimmed.length < 40) {
        return true;
      }
    }

    // Lignes qui ressemblent à des en-têtes de colonnes
    const headerKeywords = ['line', 'qty', 'quantity', 'uom', 'item', 'code', 'description', 'stock', 'cost'];
    const lowerTrimmed = trimmed.toLowerCase();
    const matchedHeaders = headerKeywords.filter(h => lowerTrimmed.includes(h));
    if (matchedHeaders.length >= 3 && trimmed.length < 60) {
      return true;
    }

    // Descriptions trop courtes SAUF si c'est un nom de pièce valide (majuscules, pas de ponctuation finale)
    const significantWords = words.filter(w => w.length >= 4 && !/^\d+$/.test(w));
    if (significantWords.length < 2 && trimmed.length < 20) {
      // Garder les noms de pièces courts en majuscules (ex: "MUFFLER", "CLAMP", "RELAY")
      const isPartName = /^[A-Z][A-Z0-9\s\-\/]+$/.test(trimmed) && !trimmed.endsWith(':') && !trimmed.endsWith(',');
      if (!isPartName) {
        return true;
      }
    }

    // Labels génériques qui ne sont pas des articles
    const genericLabels = [
      'delivery date', 'required date', 'creation date',
      'new stock item', 'sole supplier', 'short motivation',
      'additional description', 'general description',
      'recommended supplier', 'preferred supplier',
      'stock on hand', 'lead time', 'unit price',
      // Shipping/logistics
      'ship via', 'delivery loc', 'shipping method', 'freight',
      // Legal/Company info
      'régime', 'capital social', 'centre des', 'siège social',
      "côte d'ivoire", "cote d'ivoire", 'reel normal', 'ivoire capital',
      // Standards (sans description produit)
      'applicable stand', 'iec ', 'iso ',
      // Location codes
      '-whse', 'warehouse',
    ];
    for (const label of genericLabels) {
      if (lowerTrimmed.includes(label)) {
        return true;
      }
    }

    // Codes de localisation (ex: "ITY-WHSE")
    if (/^[A-Z]{2,5}-WHSE$/i.test(trimmed)) {
      return true;
    }

    // Codes seuls sans description (ex: "O770OP00M6006")
    // Pattern: code alphanumérique AVEC des chiffres, sans espaces (pas un mot simple)
    if (/^[A-Z0-9][\w\-\/\.]{5,20}$/.test(trimmed) && !trimmed.includes(' ') && /\d/.test(trimmed)) {
      // C'est un code seul (contient des chiffres), pas une description
      return true;
    }

    // Texte tronqué ou incomplet (se termine par des caractères partiels)
    if (/[,\-&]\s*$/.test(trimmed) || trimmed.length < 5) {
      return true;
    }

    return false;
  }

  /**
   * Nettoie une description
   */
  private cleanDescription(desc: string): string {
    if (!desc) return '';
    return desc
      .replace(/\s+(USD|EUR|XOF|CFA)\s*/gi, ' ')
      .replace(/\s+\d+[.,]\d+\s*(USD|EUR|XOF)/gi, '')
      .replace(/\r\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Unknown brand candidates detected during parsing (for logging)
   */
  private unknownBrandCandidates: Map<string, number> = new Map();

  /**
   * Get detected unknown brand candidates
   */
  getUnknownBrandCandidates(): Array<{ brand: string; count: number }> {
    return Array.from(this.unknownBrandCandidates.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Clear unknown brand candidates
   */
  clearUnknownBrandCandidates(): void {
    this.unknownBrandCandidates.clear();
  }

  /**
   * Extrait la marque depuis la description avec fuzzy matching
   */
  private extractBrand(description: string): string | undefined {
    const upper = description.toUpperCase();

    if (this.knownBrands.length === 0) {
      this.knownBrands = FALLBACK_BRANDS;
    }

    const sortedBrands = [...this.knownBrands].sort((a, b) => b.length - a.length);

    // Exact match first
    for (const brand of sortedBrands) {
      const regex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(upper)) {
        if (brand === 'CAT') return 'CATERPILLAR';
        return brand;
      }
    }

    // Fuzzy match for longer brands (>= 5 chars)
    const words = upper.split(/[\s\-_\/]+/).filter(w => w.length >= 4);
    for (const word of words) {
      for (const brand of sortedBrands) {
        if (brand.length >= 5) {
          const similarity = this.calculateSimilarity(word, brand);
          if (similarity >= 0.85) {
            this.logger.debug(`Fuzzy brand match: "${word}" -> "${brand}" (${(similarity * 100).toFixed(0)}%)`);
            return brand;
          }
        }
      }
    }

    // Detect potential unknown brands (capitalized words, common brand patterns)
    this.detectUnknownBrandCandidate(description);

    return undefined;
  }

  /**
   * Detect potential unknown brand candidates from description
   */
  private detectUnknownBrandCandidate(description: string): void {
    // Look for potential brand patterns:
    // - All caps words (4+ chars)
    // - Words with specific patterns (ends with -CO, -INC, -CORP, -LTD)
    const patterns = [
      /\b([A-Z]{4,15})\b/g,  // All caps word
      /\b([A-Z][A-Za-z]{3,}(?:CO|INC|CORP|LTD|SA|AG|SRL))\b/gi,  // Company suffix
    ];

    const candidates = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const candidate = match[1].toUpperCase();
        // Filter out common non-brand words
        const exclusions = [
          'RELAY', 'VALVE', 'PUMP', 'MOTOR', 'SEAL', 'BEARING', 'FILTER',
          'SHAFT', 'GEAR', 'COVER', 'PLATE', 'BOLT', 'SCREW', 'WIRE',
          'CABLE', 'HOSE', 'TUBE', 'PIPE', 'RING', 'BUSH', 'DISC',
          'THERMAL', 'OVERLOAD', 'HYDRAULIC', 'PNEUMATIC', 'ELECTRIC',
          'STEEL', 'RUBBER', 'PLASTIC', 'BRASS', 'COPPER', 'IRON',
          'EACH', 'UNIT', 'PIECE', 'PACK', 'SET', 'KIT', 'ASSY',
        ];

        if (!exclusions.includes(candidate) && !this.knownBrands.includes(candidate)) {
          candidates.add(candidate);
        }
      }
    }

    // Track candidates
    for (const candidate of candidates) {
      const count = this.unknownBrandCandidates.get(candidate) || 0;
      this.unknownBrandCandidates.set(candidate, count + 1);
    }
  }

  /**
   * Calculate string similarity (Jaro-Winkler inspired)
   */
  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    // Simple character overlap ratio
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) {
        matches++;
      }
    }

    const charOverlap = matches / longer.length;

    // Common prefix bonus
    let prefixLength = 0;
    for (let i = 0; i < Math.min(4, shorter.length); i++) {
      if (s1[i] === s2[i]) {
        prefixLength++;
      } else {
        break;
      }
    }

    const prefixBonus = prefixLength * 0.05;

    // Substring bonus
    const substringBonus = longer.includes(shorter) || shorter.includes(longer) ? 0.2 : 0;

    return Math.min(1, charOverlap + prefixBonus + substringBonus);
  }

  /**
   * Extract brand from filename
   */
  extractBrandFromFilename(filename: string): string | undefined {
    const upper = filename.toUpperCase();

    if (this.knownBrands.length === 0) {
      this.knownBrands = FALLBACK_BRANDS;
    }

    // Sort by length (longest first) to match most specific brands
    const sortedBrands = [...this.knownBrands].sort((a, b) => b.length - a.length);

    for (const brand of sortedBrands) {
      if (upper.includes(brand)) {
        if (brand === 'CAT') return 'CATERPILLAR';
        return brand;
      }
    }

    return undefined;
  }

  /**
   * Extrait le code fournisseur depuis la description
   */
  private extractSupplierCode(description: string): string | undefined {
    const patterns = [
      /\b([A-Z]{2,}[\-][A-Z0-9\-]+)\b/i,
      /\b(\d{3,}[\-\/][A-Z0-9]+)\b/i,
      /\b([A-Z]{2,}\d{4,}[A-Z0-9]*)\b/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match && match[1].length >= 5) {
        const code = match[1];
        if (!/^(USD|EUR|PCS|UNIT|TOTAL)$/i.test(code)) {
          return code.toUpperCase();
        }
      }
    }
    return undefined;
  }

  /**
   * Divise une ligne en cellules
   */
  private splitIntoCells(line: string): string[] {
    // Tab en premier
    if (line.includes('\t')) {
      return line.split('\t').map(c => c.trim()).filter(c => c);
    }

    // Point-virgule
    if (line.includes(';')) {
      return line.split(';').map(c => c.trim()).filter(c => c);
    }

    // Pipe
    if (line.includes('|')) {
      return line.split('|').map(c => c.trim()).filter(c => c);
    }

    // Espaces multiples (2+) - plus permissif
    const spaceSplit = line.split(/\s{2,}/);
    if (spaceSplit.length >= 2) {
      return spaceSplit.map(c => c.trim()).filter(c => c);
    }

    // Retourner la ligne entière
    return [line.trim()];
  }

  /**
   * Normalise le texte pour comparaison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
