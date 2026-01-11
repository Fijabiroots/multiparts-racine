/**
 * Types unifiés pour l'ingestion de documents RFQ
 * Ce module définit les types communs pour toutes les sources d'entrée
 */

import { z } from 'zod';

// ============================================================================
// SOURCE TYPES - Différents types de sources de données
// ============================================================================

export type SourceType =
  | 'email_body_text'      // Texte du corps email (plain)
  | 'email_body_html'      // HTML du corps email
  | 'email_inline_image'   // Image inline dans le corps email
  | 'attachment_pdf'       // Pièce jointe PDF
  | 'attachment_excel'     // Pièce jointe Excel
  | 'attachment_word'      // Pièce jointe Word
  | 'attachment_image';    // Pièce jointe image

export type InputType =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'email_text'
  | 'image';

// ============================================================================
// FILTERED IMAGE REASONS - Raisons de filtrage des images
// ============================================================================

export type FilterReason =
  | 'likely_signature'    // Image probablement de signature
  | 'tiny_icon'           // Icône trop petite (< 64x64)
  | 'tracking_pixel'      // Pixel de tracking (1x1, 2x2)
  | 'logo'                // Logo détecté (nom/URL)
  | 'social_icon'         // Icône réseau social
  | 'banner'              // Bannière email
  | 'aspect_ratio'        // Ratio hauteur/largeur suspect
  | 'low_ocr_value'       // Peu de texte OCR extrait
  | 'footer_position'     // Position en pied de page
  | 'cid_pattern'         // Pattern CID (Content-ID)
  | 'hex_id_pattern';     // Pattern ID hexadécimal

export interface FilteredImage {
  name: string;
  reason: FilterReason;
  width?: number;
  height?: number;
  size?: number;
  ocrText?: string;
}

// ============================================================================
// SOURCE RECORD - Enregistrement d'une source de données
// ============================================================================

export interface SourceRecord {
  type: SourceType;
  name: string;
  mime?: string;
  size?: number;
}

// ============================================================================
// DETECTED COLUMN - Colonne détectée dans un tableau
// ============================================================================

export type ColumnType =
  | 'lineNo'         // Numéro de ligne
  | 'qty'            // Quantité
  | 'uom'            // Unité de mesure
  | 'itemCode'       // Code article interne
  | 'partNumber'     // Référence fournisseur
  | 'brand'          // Marque
  | 'model'          // Modèle
  | 'description'    // Désignation
  | 'specification'  // Spécification
  | 'remark'         // Remarque
  | 'serial'         // Numéro de série
  | 'asset'          // Numéro d'immobilisation
  | 'drawing'        // Référence plan
  | 'unitPrice'      // Prix unitaire
  | 'totalPrice'     // Prix total
  | 'currency'       // Devise
  | 'deliveryDate'   // Date de livraison
  | 'deliveryLoc'    // Lieu de livraison
  | 'unknown';       // Colonne non identifiée

export interface DetectedColumn {
  type: ColumnType;
  headerText: string;        // Texte original de l'en-tête
  score: number;             // Score de confiance (0-1)
  xStart?: number;           // Position X de début (pour PDF/OCR)
  xEnd?: number;             // Position X de fin
  columnIndex?: number;      // Index de colonne (pour Excel)
}

// ============================================================================
// TOKEN - Token de texte avec position (pour PDF/OCR)
// ============================================================================

export interface TextToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  fontSize?: number;
  fontName?: string;
}

// ============================================================================
// PARSED ROW - Ligne parsée (fallback sans positions)
// ============================================================================

export interface ParsedRow {
  raw: string;               // Texte brut de la ligne
  cells: string[];           // Cellules extraites
  lineNumber?: number;       // Numéro de ligne dans le document
  isHeader?: boolean;        // Est-ce une ligne d'en-tête ?
  isContinuation?: boolean;  // Est-ce une ligne de continuation ?
}

// ============================================================================
// NORMALIZED DOCUMENT - Document normalisé pour le parsing
// ============================================================================

export interface NormalizedDocument {
  sourceType: SourceType;
  sourceName: string;

  // Mode tokens (PDF/OCR avec positions X/Y)
  hasPositions: boolean;
  tokens?: TextToken[];

  // Mode rows (fallback texte)
  rows?: ParsedRow[];

  // Tables extraites (Excel/Word)
  tables?: string[][][];

  // Texte brut complet
  rawText: string;

  // Métadonnées
  pageCount?: number;
  ocrUsedPages?: number[];
}

// ============================================================================
// PARSE LOG - Log de parsing pour audit
// ============================================================================

export interface ParseLog {
  requestId: string;
  timestamp: Date;
  sources: SourceRecord[];
  detectedInputTypes: InputType[];

  // Détection d'en-tête
  headerDetected: boolean;
  headerScore: number;
  headerPage?: number;
  headerLineIndex?: number;

  // Colonnes détectées
  detectedColumns: ColumnType[];
  columnDetails: DetectedColumn[];

  // OCR
  ocrUsed: boolean;
  ocrUsedPages: number[];
  ocrMethod?: 'tesseract' | 'pdfjs';

  // Filtrage images
  filteredImages: FilteredImage[];
  processedImages: string[];

  // Résultats
  lineCount: number;
  warnings: string[];
  errors: string[];

  // Multiline merging
  mergedContinuationLines?: number;

  // Extraction path: which method was used
  extractionPath?: 'pdfjs_layout' | 'pdf-parse' | 'ocr' | 'mixed';

  // Layout reconstruction stats (when pdfjs_layout is used)
  layoutStats?: {
    totalPages: number;
    totalTokens: number;
    totalRows: number;
    avgCellsPerRow: number;
    medianGapX: number;
  };

  // Brand detection
  unknownBrandCandidates?: string[];

  // Performance
  processingTimeMs: number;
  extractionMethod: string;
}

// ============================================================================
// COLUMN DICTIONARY - Dictionnaire pour la détection des colonnes
// ============================================================================

export const COLUMN_DICTIONARY: Record<ColumnType, string[]> = {
  lineNo: [
    // EN
    'line', 'line no', 'line number', 'ln', 'l/n', 'item', 'item no', 'item#', 'item #',
    'sr', 'seq', 'sequence', 'row', 'position', 'pos', 'no', 'no.',
    // FR
    'ligne', 'n°', 'n° ligne', 'numéro', 'numero', 'num'
  ],
  qty: [
    // EN
    'qty', 'quantity', 'quan', 'req qty', 'requested qty', 'required qty',
    'demand qty', 'order qty', 'ordered', 'qnty',
    // FR
    'qté', 'qte', 'quantité', 'quantite', 'besoin', 'nb', 'nombre',
    'sum of qty', 'total qty', 'demandées', 'demandees', 'commander', 'à commander'
  ],
  uom: [
    // EN
    'uom', 'u/m', 'u. m.', 'um', 'unit', 'unit of measure', 'unity',
    'pack', 'packaging', 'ea', 'pcs', 'pc', 'each',
    // FR
    'unité', 'unite', 'unité de mesure', 'cond', 'conditioning', 'colisage'
  ],
  itemCode: [
    // EN
    'item code', 'material', 'material code', 'mat code', 'product code',
    'stock code', 'inventory code', 'sap code', 'internal code',
    // FR
    'code article', 'code', 'article code', 'code sap', 'code interne',
    'article', 'art', 'ref interne', 'référence interne'
  ],
  partNumber: [
    // EN
    'part number', 'part no', 'part no.', 'p/n', 'pn', 'mpn', 'part #', 'part#',
    'manufacturer part', 'oem part', 'oem p/n', 'ref part', 'catalog no',
    'cat no', 'cat#', 'catalogue', 'reference part', 'mfr part no',
    // FR
    'référence', 'reference', 'réf', 'ref', 'ref fournisseur', 'supplier code',
    'code fournisseur', 'n° pièce', 'numéro de pièce'
  ],
  brand: [
    // EN
    'brand', 'manufacturer', 'mfr', 'mfg', 'make', 'oem',
    'original equipment manufacturer', 'vendor brand', 'origin',
    // FR
    'marque', 'fabricant', 'constructeur', 'vendor', 'fournisseur',
    'marque oem', 'provenance marque'
  ],
  model: [
    // EN
    'model', 'type', 'series', 'range', 'machine', 'equipment', 'application', 'for',
    // FR
    'modèle', 'modele', 'série', 'serie', 'gamme', 'equipement', 'pour'
  ],
  description: [
    // EN
    'description', 'item description', 'desc', 'product', 'service',
    'work', 'scope', 'nomenclature', 'material', 'item', 'article',
    // FR
    'désignation', 'designation', 'libellé', 'libelle', 'produit', 'objet'
  ],
  specification: [
    // EN
    'spec', 'specification', 'specifications', 'technical', 'tech', 'tech details',
    'dimension', 'dimensions', 'rating', 'class', 'pressure', 'pn', 'dn', 'size',
    // FR
    'spécification', 'spécifications', 'caractéristiques', 'technique', 'taille'
  ],
  remark: [
    // EN
    'remark', 'remarks', 'comment', 'comments', 'note', 'notes', 'observations',
    'instruction', 'instructions',
    // FR
    'remarque', 'commentaire', 'observation', 'obs', 'info', 'information',
    'précisions', 'precisions'
  ],
  serial: [
    // EN
    'serial', 'serial no', 'serial number', 's/n', 'sn', 'serial#', 'chassis', 'vin',
    // FR
    'n° série', 'numéro de série', 'numero de serie'
  ],
  asset: [
    // EN
    'asset', 'asset no', 'asset number', 'tag', 'tag no', 'tag number',
    'equipment tag', 'tag#', 'id',
    // FR
    'immobilisation', 'immo', 'equipment no', 'equipment number',
    'n° équipement', 'code équipement', 'code equipement', 'fleet', 'fleet no'
  ],
  drawing: [
    // EN
    'drawing', 'dwg', 'drawing no', 'sketch', 'diagram', 'datasheet', 'data sheet', 'manual', 'catalog',
    // FR
    'plan', 'n° plan', 'schéma', 'fiche technique'
  ],
  unitPrice: [
    // EN
    'unit price', 'u/price', 'price', 'unit cost', 'rate',
    // FR
    'prix unitaire', 'prix unit', 'p.u.', 'pu', 'coût unitaire', 'prix'
  ],
  totalPrice: [
    // EN
    'total price', 'total', 'amount', 'extended price', 'line total', 'extended',
    // FR
    'prix total', 'montant', 'total ligne'
  ],
  currency: [
    // EN + Codes
    'currency', 'cur', 'ccy', 'money', 'usd', 'eur', 'xof', 'cfa', 'fcfa',
    // FR
    'devise'
  ],
  deliveryDate: [
    // EN
    'required by', 'need by', 'delivery date', 'requested date', 'lead time', 'eta',
    // FR
    'date livraison', 'date de livraison', 'délai', 'delai', 'required date',
    'date souhaitée', 'date requise'
  ],
  deliveryLoc: [
    // EN
    'delivery loc', 'delivery location', 'ship to', 'site', 'plant', 'warehouse',
    // FR
    'livraison', 'lieu livraison', 'lieu de livraison', 'destination', 'magasin', 'livrer à'
  ],
  unknown: []
};

// ============================================================================
// COLUMN WEIGHTS - Pondération pour la détection d'en-tête
// ============================================================================

export const COLUMN_WEIGHTS: Record<ColumnType, number> = {
  lineNo: 3,       // Très indicatif d'un tableau
  qty: 3,          // Très indicatif d'un tableau
  uom: 2,          // Bon indicateur
  description: 3,  // Essentiel
  itemCode: 2,     // Bon indicateur
  partNumber: 2,   // Bon indicateur
  brand: 2,        // Utile
  model: 1,        // Optionnel
  specification: 1,
  remark: 1,
  serial: 1,
  asset: 1,
  drawing: 1,
  unitPrice: 1,
  totalPrice: 1,
  currency: 1,
  deliveryDate: 1,
  deliveryLoc: 1,
  unknown: 0,
};

// ============================================================================
// VALIDATION SCHEMAS - Schémas de validation Zod
// ============================================================================

export const PriceRequestItemSchema = z.object({
  id: z.string().optional(),
  reference: z.string().optional(),
  internalCode: z.string().optional(),
  supplierCode: z.string().optional(),
  brand: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  notes: z.string().optional(),
  serialNumber: z.string().optional(),
  needsManualReview: z.boolean().optional(),
  isEstimated: z.boolean().optional(),
  originalLine: z.number().optional(),
});

export const ParseLogSchema = z.object({
  requestId: z.string(),
  timestamp: z.date(),
  sources: z.array(z.object({
    type: z.string(),
    name: z.string(),
    mime: z.string().optional(),
    size: z.number().optional(),
  })),
  detectedInputTypes: z.array(z.string()),
  headerDetected: z.boolean(),
  headerScore: z.number(),
  headerPage: z.number().optional(),
  headerLineIndex: z.number().optional(),
  detectedColumns: z.array(z.string()),
  columnDetails: z.array(z.object({
    type: z.string(),
    headerText: z.string(),
    score: z.number(),
    xStart: z.number().optional(),
    xEnd: z.number().optional(),
    columnIndex: z.number().optional(),
  })),
  ocrUsed: z.boolean(),
  ocrUsedPages: z.array(z.number()),
  ocrMethod: z.string().optional(),
  filteredImages: z.array(z.object({
    name: z.string(),
    reason: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    size: z.number().optional(),
    ocrText: z.string().optional(),
  })),
  processedImages: z.array(z.string()),
  lineCount: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  processingTimeMs: z.number(),
  extractionMethod: z.string(),
});

export type PriceRequestItemInput = z.infer<typeof PriceRequestItemSchema>;
export type ParseLogInput = z.infer<typeof ParseLogSchema>;
