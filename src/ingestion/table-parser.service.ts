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
  rejectionReason?: string;  // Raison si le header a été rejeté
  isFormMetadata?: boolean;  // True si la ligne est une métadonnée de formulaire
}

/**
 * Table extraction result
 */
export interface TableExtractionResult {
  items: PriceRequestItem[];
  headerDetection: HeaderDetection;
  warnings: string[];
  extractionMethod: 'header-based' | 'heuristic' | 'fallback';
  mergedContinuationLines?: number;
  fallbackTriggered?: boolean;  // True si fallback a été utilisé après échec header-based
  fallbackReason?: string;      // Raison du fallback
  itemsBeforeFallback?: number; // Nombre d'items avant fallback
  // Statistiques de continuation par item
  continuationStats?: {
    itemsWithContinuations: number;    // Nombre d'items avec lignes de continuation
    maxContinuationsPerItem: number;   // Max de lignes de continuation sur un seul item
    itemsWithSingleLineQty: number;    // Items où la quantité était sur une ligne isolée
  };
  // Zone segmentation
  zoneDetection?: {
    itemsZoneStartLine?: number;
    itemsZoneEndLine?: number;
    detectionMethod: 'header-based' | 'keyword-based' | 'heuristic' | 'full-document';
    zoneLineCount: number;
  };
  // Header reappearance
  headerReappearance?: {
    repeatedHeadersIgnored: number;
    repeatedHeaderLines: number[];
  };
  // Qty lookahead/lookbehind
  qtyLookahead?: {
    qtyRecoveredViaLookahead: number;
    qtyRecoveredViaLookbehind: number;
  };
  // Spec lines
  specLinesStats?: {
    specLinesAttached: number;
    specLinePatterns: string[];
  };
  // Confidence scoring
  confidenceStats?: {
    minConfidence: number;
    maxConfidence: number;
    avgConfidence: number;
    lowConfidenceItemCount: number;
    needsVerification: boolean;
  };
  // Post-processing
  postProcessingStats?: {
    itemsMerged: number;
    emptyItemsRemoved: number;
  };
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

// Seuil minimum d'items pour considérer le parsing header-based comme réussi
const MIN_ITEMS_FOR_HEADER_SUCCESS = 3;

// Minimum de types de colonnes distincts pour un header valide
const MIN_DISTINCT_COLUMN_TYPES = 3;

// ============================================================================
// QUANTITY ANCHOR PATTERNS - Patterns pour détecter les lignes "porteuses de quantité"
// Une ligne avec quantité = début d'un nouvel item
// ============================================================================

// Pattern pour quantité avec unité (ex: "10 EA", "5.5 LOT", "100 PCS")
const QTY_WITH_UNIT_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s+(LOT|EA|EACH|PCS?|PC|UNITS?|SET|KG|M|MM|L|LTR|MTR|ROLL|BOX|PAIR)\b/i;

// Pattern pour quantité en début de ligne numérotée (ex: "10 10 EA", "1 5 LOT")
const NUMBERED_LINE_QTY_PATTERN = /^\s*\d{1,3}\s+(\d+(?:[.,]\d+)?)\s+(LOT|EA|EACH|PCS?|PC|UNITS?|SET|KG|M|MM|L|LTR|MTR|ROLL|BOX|PAIR)\b/i;

// Pattern pour identifiant fort de ligne (ex: "2.", "2.1", "Item 3", "Line 5")
const STRONG_LINE_ID_PATTERNS = [
  /^\s*(\d{1,3})\.\s/,                    // "1.", "2.", etc.
  /^\s*(\d{1,3}\.\d{1,2})\s/,             // "1.1", "2.3", etc.
  /^\s*(Item|Line|Ligne)\s*#?\s*\d+/i,    // "Item 1", "Line 3", "Ligne 5"
  /^\s*#\s*\d{1,3}\s/,                    // "# 1", "# 2"
];

// ============================================================================
// FORM METADATA KEYWORDS - Mots-clés de formulaires à rejeter comme headers
// Ces lignes sont des métadonnées de formulaire, pas des en-têtes de tableau
// ============================================================================

const FORM_METADATA_KEYWORDS = [
  'fleet number',
  'activity code',
  'gl code',
  'work order',
  'cost center',
  'cost centre',
  'requestor',
  'requester',
  'recommended supplier',
  'preferred supplier',
  'approver',
  'hod name',
  'buyer',
  'purchase requisition',
  'requisition no',
  'creation date',
  'required date',
  'delivery date',
  'sub activity',
  'budget code',
  'project code',
  'department',
];

// ============================================================================
// ZONE SEGMENTATION - Délimiteurs de zones dans les documents RFQ/PR
// ============================================================================

// Mots-clés déclenchant le DÉBUT de la zone items (header de tableau)
const ITEMS_ZONE_START_KEYWORDS = [
  // EN - Header patterns
  'line', 'qty', 'quantity', 'uom', 'unit of measure',
  'item code', 'item no', 'part number', 'part no', 'p/n',
  'item description', 'description', 'nomenclature',
  'price', 'unit price', 'extension', 'amount',
  // FR
  'ligne', 'quantité', 'qté', 'unité', 'référence', 'désignation',
  'prix unitaire', 'montant',
];

// Mots-clés déclenchant la FIN de la zone items
const ITEMS_ZONE_END_KEYWORDS = [
  // EN
  'terms and conditions', 'terms & conditions', 'general terms',
  'delivery terms', 'payment terms', 'validity',
  'notes:', 'note:', 'remarks:', 'important:',
  'signature', 'authorized by', 'approved by',
  'bank details', 'account details',
  'total amount', 'grand total', 'sub total',
  // FR
  'conditions générales', 'conditions de livraison',
  'conditions de paiement', 'validité',
  'remarques:', 'important:',
  'signature', 'approuvé par',
  'montant total', 'total général',
];

// Seuil minimum de mots-clés pour détecter un header de zone items
const MIN_ZONE_START_KEYWORDS = 3;

// ============================================================================
// SPEC LINES - Patterns pour lignes de spécifications techniques
// Ces lignes ne peuvent JAMAIS démarrer un nouvel item
// ============================================================================

// Patterns de normes et standards
const SPEC_NORM_PATTERNS = [
  /\b(IP[0-9]{2}[A-Z]?|IP[X0-9]{2})\b/i,           // IP66, IP67, IPX4
  /\b(IEC|IEEE|ASTM|DIN|ISO|EN|AISI|ANSI|BS|NF)\s*[-:]?\s*\d+/i,  // Standards
  /\b(NEMA|UL|CE|CSA|TUV)\s*[-:]?\s*\d*/i,         // Certifications
  /\b\d+\s*(VAC|VDC|V\s*AC|V\s*DC)\b/i,           // Voltages
  /\b\d+\s*(Hz|kHz|MHz)\b/i,                       // Fréquences
  /\b\d+\s*(kW|MW|HP|kVA|A|mA)\b/i,               // Puissances/Courants
  /\b\d+\s*(°C|°F|deg\s*C|deg\s*F)\b/i,           // Températures
  /\b\d+\s*(mm|cm|m|inch|in|ft|'|")\b/i,          // Dimensions
  /\b\d+\s*(kg|lb|g|ton)\b/i,                      // Poids
  /\b\d+\s*(bar|psi|kPa|MPa)\b/i,                  // Pressions
  /\b(SS|AISI)\s*\d{3}/i,                          // Aciers inox
  /\b(Grade|Class|Type)\s*[A-Z0-9]+/i,             // Classifications
];

// Pattern key:value (ex: "Enclosure: IP66", "Material: SS316")
const KEY_VALUE_PATTERN = /^[A-Za-z][A-Za-z\s]{2,25}:\s*.+/;

// ============================================================================
// CONFIDENCE SCORING - Seuils pour le scoring de confiance
// ============================================================================

const CONFIDENCE_THRESHOLD_LOW = 50;      // En dessous: item faible
const CONFIDENCE_THRESHOLD_NEEDS_REVIEW = 40;  // Seuil pour needsVerification
const MAX_LOW_CONFIDENCE_RATIO = 0.5;     // 50% d'items faibles = needsVerification

// Points pour le scoring de confiance
const CONFIDENCE_POINTS = {
  hasQty: 25,
  hasUom: 15,
  hasItemCode: 20,
  hasPartNumber: 20,
  hasLineNo: 10,
  hasDescription: 15,
  descriptionLong: 10,      // Description > 30 chars
  descriptionVeryShort: -15, // Description < 10 chars
  noQty: -20,
  noCode: -10,
};

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
   * Implémente un mécanisme de fallback si le parsing header-based échoue
   */
  parseDocument(doc: NormalizedDocument): TableExtractionResult {
    const warnings: string[] = [];
    let fallbackTriggered = false;
    let fallbackReason: string | undefined;
    let itemsBeforeFallback: number | undefined;
    let continuationStats: TableExtractionResult['continuationStats'];

    // 1. Détecter l'en-tête
    const headerDetection = this.detectHeader(doc);

    if (!headerDetection.found) {
      if (headerDetection.rejectionReason) {
        warnings.push(`Header rejected: ${headerDetection.rejectionReason}`);
        this.logger.debug(`Header rejected for ${doc.sourceName}: ${headerDetection.rejectionReason}`);
      } else {
        warnings.push('No header row detected - using heuristic parsing');
        this.logger.warn(`No header found for ${doc.sourceName}`);
      }
    } else {
      this.logger.debug(
        `Header at line ${headerDetection.lineIndex}, score ${headerDetection.score}, columns: ${headerDetection.columns.map(c => c.type).join(', ')}`
      );
    }

    // 2. Extraire les items avec l'en-tête détecté (ou heuristique si pas d'en-tête)
    let items: PriceRequestItem[] = [];
    let mergedContinuationLines = 0;

    if (doc.tables && doc.tables.length > 0) {
      items = this.extractFromTables(doc.tables, headerDetection);
    } else if (doc.rows && doc.rows.length > 0) {
      const result = this.extractFromRows(doc.rows, headerDetection);
      items = result.items;
      mergedContinuationLines = result.mergedContinuationLines;
      continuationStats = result.continuationStats;
    } else if (doc.rawText) {
      const result = this.extractFromRawText(doc.rawText, headerDetection);
      items = result.items;
      mergedContinuationLines = result.mergedContinuationLines;
      continuationStats = result.continuationStats;
    }

    this.logger.debug(`Extracted ${items.length} raw items from ${doc.sourceName} (${mergedContinuationLines} continuation lines merged)`);

    // 3. Vérifier si le parsing header-based a échoué (trop peu d'items)
    //    Si oui, déclencher le fallback heuristique
    if (headerDetection.found && items.length < MIN_ITEMS_FOR_HEADER_SUCCESS) {
      itemsBeforeFallback = items.length;
      fallbackReason = `Header-based parsing yielded only ${items.length} items (< ${MIN_ITEMS_FOR_HEADER_SUCCESS})`;
      this.logger.warn(`${fallbackReason} - triggering fallback for ${doc.sourceName}`);
      warnings.push(fallbackReason);

      // Créer un header "non trouvé" pour forcer le parsing heuristique
      const noHeader: HeaderDetection = {
        found: false,
        score: 0,
        lineIndex: -1,
        columns: [],
        rawHeaderText: '',
        rejectionReason: `Original header at line ${headerDetection.lineIndex} rejected due to insufficient items`,
      };

      // Ré-extraire avec parsing heuristique
      if (doc.tables && doc.tables.length > 0) {
        items = this.extractFromTables(doc.tables, noHeader);
      } else if (doc.rows && doc.rows.length > 0) {
        const result = this.extractFromRows(doc.rows, noHeader);
        items = result.items;
        mergedContinuationLines = result.mergedContinuationLines;
        continuationStats = result.continuationStats;
      } else if (doc.rawText) {
        const result = this.extractFromRawText(doc.rawText, noHeader);
        items = result.items;
        mergedContinuationLines = result.mergedContinuationLines;
        continuationStats = result.continuationStats;
      }

      fallbackTriggered = true;
      this.logger.debug(`Fallback extraction yielded ${items.length} items for ${doc.sourceName}`);
    }

    // 4. Post-traitement: nettoyage et enrichissement
    items = this.postProcessItems(items);

    // 5. Post-processing: merge/dedup des items
    const postProcessResult = this.postProcessMergeItems(items);
    items = postProcessResult.items;
    const postProcessingStats = {
      itemsMerged: postProcessResult.merged,
      emptyItemsRemoved: postProcessResult.removed,
    };

    if (postProcessResult.merged > 0 || postProcessResult.removed > 0) {
      this.logger.debug(`Post-processing: merged ${postProcessResult.merged}, removed ${postProcessResult.removed} weak items`);
    }

    // 6. Déterminer la méthode d'extraction finale
    let extractionMethod: 'header-based' | 'heuristic' | 'fallback';
    if (fallbackTriggered) {
      extractionMethod = 'fallback';
    } else if (headerDetection.found) {
      extractionMethod = 'header-based';
    } else {
      extractionMethod = 'heuristic';
    }

    // 7. Calculer les statistiques de confiance
    const confidenceStats = this.calculateConfidenceStats(items);
    if (confidenceStats.needsVerification) {
      warnings.push(`Low confidence extraction: ${confidenceStats.lowConfidenceItemCount}/${items.length} items below threshold`);
    }

    // 8. Zone detection (pour logging)
    let zoneDetection: TableExtractionResult['zoneDetection'];
    if (doc.rows && doc.rows.length > 0) {
      const zone = this.detectItemsZone(doc.rows, headerDetection.found ? headerDetection.lineIndex : undefined);
      zoneDetection = {
        itemsZoneStartLine: zone.startLine,
        itemsZoneEndLine: zone.endLine,
        detectionMethod: zone.detectionMethod,
        zoneLineCount: zone.endLine - zone.startLine + 1,
      };
    }

    return {
      items,
      headerDetection,
      warnings,
      extractionMethod,
      mergedContinuationLines,
      fallbackTriggered,
      fallbackReason,
      itemsBeforeFallback,
      continuationStats,
      zoneDetection,
      confidenceStats,
      postProcessingStats,
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

      // Only update bestResult if detection is valid (found: true) and better than current
      if (detection.found && detection.score > bestResult.score) {
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

      // Only update bestResult if detection is valid (found: true) and better than current
      // Or if no valid header found yet and this has higher score
      if (detection.found && detection.score > bestResult.score) {
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
   * Utilise COLUMN_DICTIONARY complet et validation stricte
   */
  private analyzeHeaderRow(cells: string[], lineIndex: number): HeaderDetection {
    const rawText = cells.join(' ').trim();

    // 1. Vérifier si c'est une ligne de métadonnées de formulaire
    if (this.isFormMetadataRow(rawText)) {
      return {
        found: false,
        score: 0,
        lineIndex,
        columns: [],
        rawHeaderText: rawText,
        isFormMetadata: true,
        rejectionReason: 'Line is form metadata (not item table header)',
      };
    }

    const columns: DetectedColumn[] = [];
    let totalScore = 0;

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
      }
    }

    // 2. Dédupliquer les colonnes (garder meilleur score par type)
    const dedupedColumns = this.deduplicateColumns(columns);

    // 3. Appliquer la validation stricte RFQ
    const validation = this.isValidRfqHeader(dedupedColumns);

    if (!validation.valid) {
      this.logger.debug(`Header rejected at line ${lineIndex}: ${validation.reason}`);
      return {
        found: false,
        score: 0,  // Set to 0 so rejected headers don't get selected as "best"
        lineIndex,
        columns: dedupedColumns,
        rawHeaderText: rawText,
        rejectionReason: validation.reason,
      };
    }

    // Recalculer le score avec les colonnes dédupliquées
    const dedupedTypes = new Set(dedupedColumns.map(c => c.type));
    let finalScore = 0;
    for (const col of dedupedColumns) {
      const weight = COLUMN_WEIGHTS[col.type] || 1;
      finalScore += weight * col.score;
    }

    // Bonus si on a la combo description + qty
    if (dedupedTypes.has('description') && dedupedTypes.has('qty')) {
      finalScore += 3;
    }

    return {
      found: finalScore >= MIN_HEADER_SCORE,
      score: finalScore,
      lineIndex,
      columns: dedupedColumns,
      rawHeaderText: rawText,
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
   *
   * Règles de continuation:
   * - La QUANTITÉ est l'ancre de l'item (ligne porteuse de quantité = nouvel item)
   * - Les lignes suivantes sans quantité ni identifiant fort sont des continuations
   * - La longueur du bloc de description n'est pas un critère de rejet
   */
  private extractFromRows(rows: ParsedRow[], header: HeaderDetection): {
    items: PriceRequestItem[];
    mergedContinuationLines: number;
    continuationStats: {
      itemsWithContinuations: number;
      maxContinuationsPerItem: number;
      itemsWithSingleLineQty: number;
    };
  } {
    const items: PriceRequestItem[] = [];
    const startRow = header.found ? header.lineIndex + 1 : 0;
    let mergedContinuationLines = 0;
    let lastItem: PriceRequestItem | null = null;

    // Stats de continuation par item
    const continuationsPerItem = new Map<PriceRequestItem, number>();
    let itemsWithSingleLineQty = 0;

    this.logger.debug(`Extracting from rows starting at ${startRow}, total rows: ${rows.length}`);

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row.raw.trim()) continue;

      if (this.isNoiseLine(row.raw)) continue;

      const cells = row.cells.length > 1 ? row.cells : this.splitIntoCells(row.raw);

      // Nouvelle logique: utiliser mustBeContinuation() pour déterminer
      // si la ligne DOIT être rattachée à l'item précédent
      if (lastItem && this.mustBeContinuation(cells, row.raw)) {
        // Merge obligatoire avec l'item précédent
        const continuationText = this.extractContinuationText(cells, row.raw);
        if (continuationText) {
          lastItem.description = (lastItem.description + ' ' + continuationText).trim();
          if (!lastItem.notes) {
            lastItem.notes = '';
          }
          lastItem.notes = (lastItem.notes + '\n[+] ' + continuationText).trim();
          mergedContinuationLines++;

          // Incrémenter le compteur de continuations pour cet item
          const currentCount = continuationsPerItem.get(lastItem) || 0;
          continuationsPerItem.set(lastItem, currentCount + 1);

          this.logger.debug(`Merged continuation line ${i}: "${continuationText.substring(0, 50)}..."`);
          continue;
        }
      }

      if (this.isEmptyDataRow(cells)) continue;

      // Vérifier si c'est une ligne porteuse de quantité (ancre)
      const qtyAnchor = this.isQuantityAnchorLine(row.raw, cells);

      const item = this.extractItemFromCells(cells, header.columns, i);
      if (item) {
        // Si la quantité a été détectée sur cette ligne seule
        if (qtyAnchor.isAnchor) {
          itemsWithSingleLineQty++;
          // Utiliser la quantité et unité détectées si pas déjà définies
          if (qtyAnchor.quantity && (item.quantity === 1 || !item.quantity)) {
            item.quantity = qtyAnchor.quantity;
          }
          if (qtyAnchor.unit && (item.unit === 'pcs' || !item.unit)) {
            item.unit = qtyAnchor.unit;
          }
        }

        items.push(item);
        lastItem = item;
        continuationsPerItem.set(item, 0); // Initialiser le compteur
      }
    }

    // Calculer les stats
    const continuationCounts = Array.from(continuationsPerItem.values());
    const itemsWithContinuations = continuationCounts.filter(c => c > 0).length;
    const maxContinuationsPerItem = Math.max(0, ...continuationCounts);

    this.logger.debug(
      `Extraction stats: ${items.length} items, ${mergedContinuationLines} continuations merged, ` +
      `${itemsWithContinuations} items with continuations, max ${maxContinuationsPerItem} per item`
    );

    return {
      items,
      mergedContinuationLines,
      continuationStats: {
        itemsWithContinuations,
        maxContinuationsPerItem,
        itemsWithSingleLineQty,
      },
    };
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
   * Vérifie si une ligne est une "ligne porteuse de quantité" (ancre d'item)
   * Une telle ligne indique le DÉBUT d'un nouvel item.
   *
   * Patterns reconnus:
   * - "10 EA description..."
   * - "5.5 LOT GPART 1.6m"
   * - "1 10 EA 201368 RELAY..."
   *
   * @param raw - Le texte brut de la ligne
   * @param cells - Les cellules parsées
   * @returns { isAnchor: boolean, quantity?: number, unit?: string }
   */
  private isQuantityAnchorLine(raw: string, cells: string[]): { isAnchor: boolean; quantity?: number; unit?: string } {
    const trimmed = raw.trim();

    // Pattern 1: Ligne numérotée avec quantité et unité (ex: "10 10 EA ...")
    const numberedMatch = trimmed.match(NUMBERED_LINE_QTY_PATTERN);
    if (numberedMatch) {
      const qty = parseFloat(numberedMatch[1].replace(',', '.'));
      if (qty > 0 && qty <= 9999) {
        return { isAnchor: true, quantity: qty, unit: numberedMatch[2].toUpperCase() };
      }
    }

    // Pattern 2: Quantité avec unité en début de ligne (ex: "10 EA ...")
    const qtyUnitMatch = trimmed.match(QTY_WITH_UNIT_PATTERN);
    if (qtyUnitMatch) {
      const qty = parseFloat(qtyUnitMatch[1].replace(',', '.'));
      if (qty > 0 && qty <= 9999) {
        return { isAnchor: true, quantity: qty, unit: qtyUnitMatch[2].toUpperCase() };
      }
    }

    // Pattern 3: Vérifier dans les cellules pour quantité + unité adjacentes
    for (let i = 0; i < cells.length - 1; i++) {
      const cellA = String(cells[i] || '').trim();
      const cellB = String(cells[i + 1] || '').trim();

      // Quantité numérique
      if (/^\d+([.,]\d+)?$/.test(cellA)) {
        const qty = parseFloat(cellA.replace(',', '.'));
        // Unité dans la cellule suivante
        if (qty > 0 && qty <= 9999 && /^(LOT|EA|EACH|PCS?|PC|UNITS?|SET|KG|M|MM|L|LTR|MTR|ROLL|BOX|PAIR)$/i.test(cellB)) {
          return { isAnchor: true, quantity: qty, unit: cellB.toUpperCase() };
        }
      }
    }

    // Pattern 4: Quantité seule dans une cellule (sans unité adjacente) - moins fiable
    for (const cell of cells) {
      const s = String(cell || '').trim();
      if (/^\d{1,4}([.,]\d+)?$/.test(s)) {
        const qty = parseFloat(s.replace(',', '.'));
        if (qty > 0 && qty <= 9999) {
          // Ne pas considérer comme ancre si c'est le seul élément ou trop petit contexte
          // On accepte seulement si la ligne a du contenu significatif
          const hasDescription = cells.some(c => String(c || '').trim().length >= 10);
          if (hasDescription) {
            return { isAnchor: true, quantity: qty, unit: 'EA' };
          }
        }
      }
    }

    return { isAnchor: false };
  }

  /**
   * Vérifie si une ligne contient un identifiant fort de ligne
   * Patterns: "1.", "2.1", "Item 3", "Line 5", "# 1"
   *
   * Une ligne avec identifiant fort peut créer un item MÊME sans quantité
   * (la quantité sera cherchée dans les lignes suivantes ou défaut à 1)
   */
  private hasStrongLineIdentifier(raw: string): { hasId: boolean; lineId?: string } {
    const trimmed = raw.trim();

    for (const pattern of STRONG_LINE_ID_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        return { hasId: true, lineId: match[1] || match[0].trim() };
      }
    }

    return { hasId: false };
  }

  /**
   * Détermine si une ligne doit être traitée comme continuation obligatoire
   *
   * Règles:
   * 1. Pas de quantité détectée
   * 2. Pas d'identifiant fort de ligne
   * 3. Pas de code article/référence
   * 4. Contient du texte significatif
   *
   * @returns true si la ligne DOIT être une continuation (pas de choix)
   */
  private mustBeContinuation(cells: string[], raw: string): boolean {
    const trimmed = raw.trim();

    // Trop court pour être significatif
    if (trimmed.length < 5) return false;

    // A une quantité? -> peut être un nouvel item
    const qtyCheck = this.isQuantityAnchorLine(raw, cells);
    if (qtyCheck.isAnchor) return false;

    // A un identifiant fort? -> peut être un nouvel item
    const idCheck = this.hasStrongLineIdentifier(raw);
    if (idCheck.hasId) return false;

    // A un code article? -> peut être un nouvel item
    if (this.rowHasCode(cells)) return false;

    // Ressemble à un header de tableau?
    const headerKeywords = ['line', 'qty', 'quantity', 'uom', 'item', 'code', 'description', 'stock', 'unit'];
    const lowerRaw = trimmed.toLowerCase();
    const matchedHeaders = headerKeywords.filter(h => {
      // Match mot entier seulement
      const regex = new RegExp(`\\b${h}\\b`, 'i');
      return regex.test(lowerRaw);
    });
    if (matchedHeaders.length >= 2) return false;

    // Est-ce du bruit?
    if (this.isNoiseLine(trimmed)) return false;

    // Contient du texte significatif (au moins quelques mots)
    const words = trimmed.split(/\s+/).filter(w => w.length >= 2);
    if (words.length < 1) return false;

    // C'est une continuation
    return true;
  }

  /**
   * Extrait les items depuis du texte brut
   */
  private extractFromRawText(text: string, header: HeaderDetection): {
    items: PriceRequestItem[];
    mergedContinuationLines: number;
    continuationStats: {
      itemsWithContinuations: number;
      maxContinuationsPerItem: number;
      itemsWithSingleLineQty: number;
    };
  } {
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

  // ============================================================================
  // VALIDATION DES HEADERS RFQ
  // ============================================================================

  /**
   * Vérifie si une ligne est une ligne de métadonnées de formulaire
   * (pas un header de tableau d'items)
   *
   * @param lineText - Le texte brut de la ligne
   * @returns true si c'est une ligne de métadonnées, false sinon
   */
  private isFormMetadataRow(lineText: string): boolean {
    const normalized = lineText.toLowerCase().replace(/[\r\n]/g, ' ');

    let matchCount = 0;
    for (const keyword of FORM_METADATA_KEYWORDS) {
      if (normalized.includes(keyword)) {
        matchCount++;
        if (matchCount >= 2) {
          this.logger.debug(`Form metadata detected: "${lineText.substring(0, 60)}..." (matched ${matchCount} keywords)`);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Vérifie si les colonnes détectées forment un header RFQ valide
   *
   * Règles:
   * 1. DOIT avoir une colonne 'description'
   * 2. DOIT avoir une colonne 'qty' (obligatoire pour RFQ)
   * 3. DOIT avoir au moins un de: uom, itemCode, partNumber, lineNo
   * 4. DOIT avoir >= 3 types de colonnes DISTINCTS
   * 5. NE DOIT PAS avoir de types de colonnes dupliqués
   *
   * @param columns - Les colonnes détectées
   * @returns { valid: boolean, reason?: string }
   */
  private isValidRfqHeader(columns: DetectedColumn[]): { valid: boolean; reason?: string } {
    if (columns.length === 0) {
      return { valid: false, reason: 'No columns detected' };
    }

    // Extraire les types de colonnes
    const columnTypes = columns.map(c => c.type);
    const uniqueTypes = new Set(columnTypes);

    // Vérifier les doublons
    if (columnTypes.length !== uniqueTypes.size) {
      const duplicates = columnTypes.filter((t, i) => columnTypes.indexOf(t) !== i);
      return {
        valid: false,
        reason: `Duplicate column types: ${[...new Set(duplicates)].join(', ')}`
      };
    }

    // Vérifier les colonnes obligatoires
    const hasDescription = uniqueTypes.has('description');
    const hasQty = uniqueTypes.has('qty');
    const hasSecondary = uniqueTypes.has('uom') ||
                         uniqueTypes.has('itemCode') ||
                         uniqueTypes.has('partNumber') ||
                         uniqueTypes.has('lineNo');

    if (!hasDescription) {
      return { valid: false, reason: 'Missing required column: description' };
    }

    if (!hasQty) {
      return { valid: false, reason: 'Missing required column: qty (quantity)' };
    }

    if (!hasSecondary) {
      return { valid: false, reason: 'Missing secondary column (uom, itemCode, partNumber, or lineNo)' };
    }

    // Vérifier le nombre minimum de types distincts
    if (uniqueTypes.size < MIN_DISTINCT_COLUMN_TYPES) {
      return {
        valid: false,
        reason: `Insufficient column types: ${uniqueTypes.size} < ${MIN_DISTINCT_COLUMN_TYPES}`
      };
    }

    return { valid: true };
  }

  /**
   * Déduplique les colonnes en gardant celle avec le meilleur score pour chaque type
   *
   * @param columns - Les colonnes détectées (peut contenir des doublons)
   * @returns Les colonnes dédupliquées
   */
  private deduplicateColumns(columns: DetectedColumn[]): DetectedColumn[] {
    const bestByType = new Map<ColumnType, DetectedColumn>();

    for (const col of columns) {
      const existing = bestByType.get(col.type);
      if (!existing || col.score > existing.score) {
        bestByType.set(col.type, col);
      }
    }

    return Array.from(bestByType.values()).sort((a, b) =>
      (a.columnIndex || 0) - (b.columnIndex || 0)
    );
  }

  // ============================================================================
  // ZONE SEGMENTATION
  // ============================================================================

  /**
   * Détecte les bornes de la zone items dans le document
   * @param rows - Les lignes du document
   * @param headerLineIndex - Index de l'en-tête détecté (si trouvé)
   * @returns Les bornes de la zone et la méthode de détection
   */
  detectItemsZone(rows: ParsedRow[], headerLineIndex?: number): {
    startLine: number;
    endLine: number;
    detectionMethod: 'header-based' | 'keyword-based' | 'heuristic' | 'full-document';
  } {
    let startLine = 0;
    let endLine = rows.length - 1;
    let detectionMethod: 'header-based' | 'keyword-based' | 'heuristic' | 'full-document' = 'full-document';

    // Si on a un header détecté, commencer juste après
    if (headerLineIndex !== undefined && headerLineIndex >= 0) {
      startLine = headerLineIndex + 1;
      detectionMethod = 'header-based';
    } else {
      // Chercher le début par mots-clés
      for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SEARCH_LINES); i++) {
        const lineText = rows[i].raw.toLowerCase();
        let matchCount = 0;
        for (const keyword of ITEMS_ZONE_START_KEYWORDS) {
          if (lineText.includes(keyword)) {
            matchCount++;
          }
        }
        if (matchCount >= MIN_ZONE_START_KEYWORDS) {
          startLine = i + 1; // Commencer après cette ligne
          detectionMethod = 'keyword-based';
          this.logger.debug(`Zone items start detected at line ${i} (${matchCount} keywords matched)`);
          break;
        }
      }
    }

    // Chercher la fin par mots-clés (à partir de la moitié du document)
    const searchStart = Math.max(startLine, Math.floor(rows.length / 2));
    for (let i = searchStart; i < rows.length; i++) {
      const lineText = rows[i].raw.toLowerCase();
      for (const keyword of ITEMS_ZONE_END_KEYWORDS) {
        if (lineText.includes(keyword)) {
          endLine = i - 1;
          this.logger.debug(`Zone items end detected at line ${i} (keyword: "${keyword}")`);
          break;
        }
      }
      if (endLine < rows.length - 1) break;
    }

    return { startLine, endLine, detectionMethod };
  }

  // ============================================================================
  // HEADER REAPPEARANCE DETECTION
  // ============================================================================

  /**
   * Vérifie si une ligne est une réapparition du header (multi-page)
   * @param lineText - Le texte de la ligne
   * @param headerTokens - Les tokens du header original (normalisés)
   * @returns true si c'est un header répété
   */
  private isHeaderReappearance(lineText: string, headerTokens: string[]): boolean {
    if (headerTokens.length === 0) return false;

    const lineNorm = this.normalizeText(lineText);
    const lineTokens = lineNorm.split(/\s+/).filter(t => t.length >= 2);

    // Compter les tokens du header présents dans la ligne
    let matchCount = 0;
    for (const headerToken of headerTokens) {
      if (lineTokens.some(t => t === headerToken || t.includes(headerToken))) {
        matchCount++;
      }
    }

    // Si plus de 60% des tokens du header sont présents, c'est une réapparition
    const matchRatio = matchCount / headerTokens.length;
    return matchRatio >= 0.6;
  }

  /**
   * Extrait les tokens significatifs d'un header pour comparaison
   * @param headerText - Le texte du header
   * @returns Les tokens normalisés
   */
  private extractHeaderTokens(headerText: string): string[] {
    const norm = this.normalizeText(headerText);
    return norm.split(/\s+/).filter(t => t.length >= 3);
  }

  // ============================================================================
  // SPEC LINE CLASSIFICATION
  // ============================================================================

  /**
   * Vérifie si une ligne est une ligne de spécification technique
   * Une spec line ne peut JAMAIS démarrer un nouvel item
   *
   * @param lineText - Le texte de la ligne
   * @returns { isSpec: boolean, patterns: string[] } - patterns trouvés
   */
  isSpecLine(lineText: string): { isSpec: boolean; patterns: string[] } {
    const patterns: string[] = [];
    const trimmed = lineText.trim();

    // Vérifier le pattern key:value
    if (KEY_VALUE_PATTERN.test(trimmed)) {
      // Vérifier que ce n'est pas un faux positif (header de colonne, etc.)
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIndex).toLowerCase();
      // Exclure les faux positifs courants
      if (!['line', 'item', 'qty', 'quantity', 'uom', 'description'].includes(key)) {
        patterns.push('key:value');
      }
    }

    // Vérifier les patterns de normes/specs
    for (const pattern of SPEC_NORM_PATTERNS) {
      if (pattern.test(trimmed)) {
        const match = trimmed.match(pattern);
        if (match) {
          patterns.push(match[0]);
        }
      }
    }

    return {
      isSpec: patterns.length > 0,
      patterns,
    };
  }

  // ============================================================================
  // QTY LOOKAHEAD/LOOKBEHIND
  // ============================================================================

  /**
   * Tente de récupérer la quantité depuis une ligne adjacente
   * Utilisé quand une ligne a un itemCode/partNo mais pas de qty
   *
   * @param rows - Les lignes du document
   * @param currentIndex - Index de la ligne courante
   * @param direction - 'next' ou 'prev'
   * @returns { found: boolean, qty?: number, unit?: string, lineIndex?: number }
   */
  private tryRecoverQtyFromAdjacentLine(
    rows: ParsedRow[],
    currentIndex: number,
    direction: 'next' | 'prev'
  ): { found: boolean; qty?: number; unit?: string; lineIndex?: number } {
    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (targetIndex < 0 || targetIndex >= rows.length) {
      return { found: false };
    }

    const targetRow = rows[targetIndex];
    const cells = targetRow.cells.length > 1 ? targetRow.cells : this.splitIntoCells(targetRow.raw);

    // Vérifier si la ligne cible contient une quantité
    const qtyAnchor = this.isQuantityAnchorLine(targetRow.raw, cells);
    if (qtyAnchor.isAnchor && qtyAnchor.quantity) {
      // Vérifier que la ligne n'est pas elle-même un item complet
      // (elle ne devrait avoir que qty/uom, pas de description longue)
      const hasLongDescription = cells.some(c => String(c || '').trim().length > 20);
      if (!hasLongDescription) {
        return {
          found: true,
          qty: qtyAnchor.quantity,
          unit: qtyAnchor.unit,
          lineIndex: targetIndex,
        };
      }
    }

    return { found: false };
  }

  // ============================================================================
  // TEXT NORMALIZATION
  // ============================================================================

  /**
   * Normalise le texte avant parsing (ligatures, newlines, espaces)
   * @param text - Le texte brut
   * @returns Le texte normalisé
   */
  normalizeTextForParsing(text: string): string {
    return text
      // Unifier les newlines
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Corriger les ligatures courantes
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl')
      .replace(/ﬀ/g, 'ff')
      .replace(/ﬃ/g, 'ffi')
      .replace(/ﬄ/g, 'ffl')
      // Réduire les espaces multiples (mais garder les newlines)
      .replace(/[^\S\n]+/g, ' ')
      // Nettoyer les espaces autour des newlines
      .replace(/ *\n */g, '\n')
      .trim();
  }

  // ============================================================================
  // CONFIDENCE SCORING
  // ============================================================================

  /**
   * Calcule le score de confiance pour un item extrait
   * @param item - L'item extrait
   * @returns Le score de confiance (0-100)
   */
  calculateItemConfidence(item: PriceRequestItem): number {
    let score = 50; // Score de base

    // Points positifs
    if (item.quantity && item.quantity > 0) score += CONFIDENCE_POINTS.hasQty;
    if (item.unit && item.unit !== 'pcs') score += CONFIDENCE_POINTS.hasUom;
    if (item.internalCode) score += CONFIDENCE_POINTS.hasItemCode;
    if (item.supplierCode) score += CONFIDENCE_POINTS.hasPartNumber;
    if (item.originalLine !== undefined) score += CONFIDENCE_POINTS.hasLineNo;
    if (item.description && item.description.length > 0) score += CONFIDENCE_POINTS.hasDescription;
    if (item.description && item.description.length > 30) score += CONFIDENCE_POINTS.descriptionLong;

    // Points négatifs
    if (!item.quantity || item.quantity === 0) score += CONFIDENCE_POINTS.noQty;
    if (!item.internalCode && !item.supplierCode) score += CONFIDENCE_POINTS.noCode;
    if (item.description && item.description.length < 10) score += CONFIDENCE_POINTS.descriptionVeryShort;

    // Clamp entre 0 et 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calcule les statistiques de confiance pour tous les items
   * @param items - Les items extraits
   * @returns Les statistiques de confiance
   */
  calculateConfidenceStats(items: PriceRequestItem[]): {
    minConfidence: number;
    maxConfidence: number;
    avgConfidence: number;
    lowConfidenceItemCount: number;
    needsVerification: boolean;
  } {
    if (items.length === 0) {
      return {
        minConfidence: 0,
        maxConfidence: 0,
        avgConfidence: 0,
        lowConfidenceItemCount: 0,
        needsVerification: true,
      };
    }

    const scores = items.map(item => this.calculateItemConfidence(item));
    const minConfidence = Math.min(...scores);
    const maxConfidence = Math.max(...scores);
    const avgConfidence = scores.reduce((a, b) => a + b, 0) / scores.length;
    const lowConfidenceItemCount = scores.filter(s => s < CONFIDENCE_THRESHOLD_LOW).length;

    // Déclencher needsVerification si trop d'items faibles
    const lowRatio = lowConfidenceItemCount / items.length;
    const needsVerification = lowRatio > MAX_LOW_CONFIDENCE_RATIO || minConfidence < CONFIDENCE_THRESHOLD_NEEDS_REVIEW;

    return {
      minConfidence: Math.round(minConfidence),
      maxConfidence: Math.round(maxConfidence),
      avgConfidence: Math.round(avgConfidence),
      lowConfidenceItemCount,
      needsVerification,
    };
  }

  // ============================================================================
  // POST-PROCESSING - MERGE/DEDUP
  // ============================================================================

  /**
   * Fusionne les items consécutifs si approprié
   * - Même itemCode/partNumber et second sans qty
   * - Second item ressemble à une continuation
   *
   * @param items - Les items extraits
   * @returns { items: PriceRequestItem[], merged: number, removed: number }
   */
  postProcessMergeItems(items: PriceRequestItem[]): {
    items: PriceRequestItem[];
    merged: number;
    removed: number;
  } {
    if (items.length < 2) {
      return { items, merged: 0, removed: 0 };
    }

    const result: PriceRequestItem[] = [];
    let merged = 0;
    let removed = 0;

    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      const next = items[i + 1];

      // Si item courant est "vide" (description trop courte, pas de code), le rattacher au précédent
      if (result.length > 0 && this.isWeakItem(current)) {
        const prev = result[result.length - 1];
        prev.description = (prev.description + ' ' + current.description).trim();
        if (current.notes) {
          prev.notes = ((prev.notes || '') + '\n' + current.notes).trim();
        }
        removed++;
        continue;
      }

      // Vérifier si on doit fusionner avec le suivant
      if (next && this.shouldMergeItems(current, next)) {
        // Fusionner
        current.description = (current.description + ' ' + next.description).trim();
        if (next.notes) {
          current.notes = ((current.notes || '') + '\n' + next.notes).trim();
        }
        // Si le suivant a une qty et pas le courant, prendre celle du suivant
        if ((!current.quantity || current.quantity === 1) && next.quantity && next.quantity > 1) {
          current.quantity = next.quantity;
          current.unit = next.unit || current.unit;
        }
        merged++;
        i++; // Sauter le suivant car fusionné
      }

      result.push(current);
    }

    return { items: result, merged, removed };
  }

  /**
   * Vérifie si un item est "faible" (candidat à être rattaché)
   */
  private isWeakItem(item: PriceRequestItem): boolean {
    const hasCode = item.internalCode || item.supplierCode || item.reference;
    const hasQty = item.quantity && item.quantity > 0;
    const hasShortDesc = !item.description || item.description.length < 15;

    // Item faible si: pas de code, pas de qty, et description courte
    return !hasCode && !hasQty && hasShortDesc;
  }

  /**
   * Vérifie si deux items consécutifs devraient être fusionnés
   */
  private shouldMergeItems(current: PriceRequestItem, next: PriceRequestItem): boolean {
    // Même itemCode/partNumber
    const sameCode = (current.internalCode && current.internalCode === next.internalCode) ||
                     (current.supplierCode && current.supplierCode === next.supplierCode);

    if (sameCode) {
      // Si le second n'a pas de qty, c'est probablement une continuation
      if (!next.quantity || next.quantity === 1) {
        return true;
      }
    }

    // Si le second item n'a ni code ni qty, c'est une continuation
    const nextHasNoCode = !next.internalCode && !next.supplierCode && !next.reference;
    const nextHasNoQty = !next.quantity || next.quantity === 1;

    if (nextHasNoCode && nextHasNoQty && next.description && next.description.length < 50) {
      return true;
    }

    return false;
  }
}
