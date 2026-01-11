import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

// pdfjs-dist (Node build)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PageText = { page: number; text: string; ocrUsed: boolean };

// ============================================================================
// PDF TOKEN EXTRACTION WITH COORDINATES (for layout-based parsing)
// ============================================================================

/**
 * A text token from PDF with position coordinates
 */
export interface PdfToken {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

/**
 * A reconstructed row from PDF tokens
 */
export interface PdfRow {
  raw: string;
  cells: string[];
  page: number;
  lineNumber: number;
  y: number;
}

/**
 * Statistics about token/row reconstruction
 */
export interface LayoutExtractionStats {
  totalPages: number;
  totalTokens: number;
  totalRows: number;
  avgCellsPerRow: number;
  medianGapX: number;
}

/**
 * Configuration for layout extraction
 */
export interface LayoutExtractionConfig {
  yTolerance?: number;       // vertical tolerance for grouping tokens into rows (default: 3)
  minGapForCell?: number;    // minimum x-gap to create new cell (default: 10)
  dynamicGap?: boolean;      // use dynamic gap based on median (default: true)
  gapMultiplier?: number;    // multiplier for dynamic gap (default: 1.8)
}

export interface ExtractTextOptions {
  minCharsPerPage?: number; // seuil déclenchement OCR
  ocrLang?: string; // "fra+eng"
  ocrDpi?: number; // 200-300
  maxOcrPages?: number; // protection perf
}

async function pdftoppmToPngs(
  pdfPath: string,
  outDir: string,
  dpi: number,
): Promise<string[]> {
  const prefix = path.join(outDir, 'page');
  await new Promise<void>((resolve, reject) => {
    const p = spawn('pdftoppm', ['-png', '-r', String(dpi), pdfPath, prefix], {
      windowsHide: true,
    });

    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftoppm failed (code ${code}): ${stderr}`));
    });
  });

  // files like page-1.png, page-2.png...
  const files = (await fs.readdir(outDir))
    .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
    .sort((a, b) => {
      const na = Number(a.match(/page-(\d+)\.png/)?.[1] ?? 0);
      const nb = Number(b.match(/page-(\d+)\.png/)?.[1] ?? 0);
      return na - nb;
    })
    .map((f) => path.join(outDir, f));

  return files;
}

export async function extractPdfTextWithOcrFallback(
  pdfPath: string,
  opts: ExtractTextOptions = {},
): Promise<PageText[]> {
  const {
    minCharsPerPage = 40,
    ocrLang = 'fra+eng',
    ocrDpi = 220,
    maxOcrPages = 10,
  } = opts;

  const data = await fs.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages: PageText[] = [];
  const lowTextPages: number[] = [];

  // 1) pdfjs text extraction
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();

    const text = tc.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({ page: i, text, ocrUsed: false });

    if (text.length < minCharsPerPage) lowTextPages.push(i);
  }

  // Rien à OCR
  if (lowTextPages.length === 0) return pages;

  // 2) OCR fallback (Poppler -> PNG -> Tesseract)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rfq-pdf-'));
  try {
    const pngs = await pdftoppmToPngs(pdfPath, tmpDir, ocrDpi);

    const worker = await createWorker(ocrLang);
    let used = 0;

    for (const pno of lowTextPages) {
      if (used >= maxOcrPages) break;

      const pngPath = pngs[pno - 1];
      if (!pngPath) continue;

      // preprocess pour OCR plus stable
      const img = await sharp(pngPath).grayscale().normalize().toBuffer();
      const res = await worker.recognize(img);

      const ocrText = (res.data.text ?? '').replace(/\s+/g, ' ').trim();
      if (ocrText.length > pages[pno - 1].text.length) {
        pages[pno - 1] = { page: pno, text: ocrText, ocrUsed: true };
        used++;
      }
    }

    await worker.terminate();
    return pages;
  } catch (error) {
    // Si OCR échoue (poppler non installé), retourner les pages sans OCR
    console.warn('OCR fallback failed:', error);
    return pages;
  } finally {
    // cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Version simplifiée sans OCR pour environnements sans Poppler
 */
export async function extractPdfTextSimple(pdfPath: string): Promise<string> {
  const data = await fs.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  const texts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();

    const text = tc.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    texts.push(text);
  }

  return texts.join('\n');
}

// ============================================================================
// LAYOUT-BASED EXTRACTION (tokens with x/y coordinates)
// ============================================================================

/**
 * Extract PDF tokens with x/y coordinates from a buffer
 * This preserves spatial information for accurate column detection
 */
export async function extractPdfTokens(buffer: Buffer): Promise<PdfToken[]> {
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  const tokens: PdfToken[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    for (const item of textContent.items) {
      if (typeof (item as any).str !== 'string') continue;

      const itemAny = item as any;
      const str = itemAny.str;

      // Skip empty strings
      if (!str || str.trim() === '') continue;

      // Transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const transform = itemAny.transform || [1, 0, 0, 1, 0, 0];
      const x = transform[4];
      const y = transform[5];
      const width = itemAny.width || str.length * 5; // estimate if not available
      const height = itemAny.height || Math.abs(transform[0]) || 10;

      tokens.push({
        str,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
        page: pageNum,
      });
    }
  }

  return tokens;
}

/**
 * Extract PDF tokens from a file path
 */
export async function extractPdfTokensFromFile(pdfPath: string): Promise<PdfToken[]> {
  const buffer = await fs.readFile(pdfPath);
  return extractPdfTokens(buffer);
}

/**
 * Group tokens into rows based on y-coordinate proximity
 * Then segment each row into cells based on x-gaps
 */
export function tokensToRows(
  tokens: PdfToken[],
  config: LayoutExtractionConfig = {},
): { rows: PdfRow[]; stats: LayoutExtractionStats } {
  const {
    yTolerance = 3,
    minGapForCell = 10,
    dynamicGap = true,
    gapMultiplier = 1.8,
  } = config;

  if (tokens.length === 0) {
    return {
      rows: [],
      stats: {
        totalPages: 0,
        totalTokens: 0,
        totalRows: 0,
        avgCellsPerRow: 0,
        medianGapX: 0,
      },
    };
  }

  // Group tokens by page
  const tokensByPage = new Map<number, PdfToken[]>();
  for (const token of tokens) {
    const pageTokens = tokensByPage.get(token.page) || [];
    pageTokens.push(token);
    tokensByPage.set(token.page, pageTokens);
  }

  const allRows: PdfRow[] = [];
  const allGaps: number[] = [];
  let globalLineNumber = 0;

  // Process each page
  for (const [pageNum, pageTokens] of tokensByPage) {
    // Sort by y (descending - PDF y grows upward) then by x
    const sorted = [...pageTokens].sort((a, b) => {
      const yDiff = b.y - a.y; // Higher y first (top of page)
      if (Math.abs(yDiff) > yTolerance) return yDiff;
      return a.x - b.x; // Left to right within same row
    });

    // Group into rows by y-proximity
    const rowGroups: PdfToken[][] = [];
    let currentRow: PdfToken[] = [];
    let currentY = sorted[0]?.y ?? 0;

    for (const token of sorted) {
      if (currentRow.length === 0) {
        currentRow.push(token);
        currentY = token.y;
      } else if (Math.abs(token.y - currentY) <= yTolerance) {
        currentRow.push(token);
      } else {
        // New row
        if (currentRow.length > 0) {
          rowGroups.push(currentRow);
        }
        currentRow = [token];
        currentY = token.y;
      }
    }
    if (currentRow.length > 0) {
      rowGroups.push(currentRow);
    }

    // Collect x-gaps for dynamic threshold calculation
    for (const row of rowGroups) {
      const sortedByX = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sortedByX.length; i++) {
        const prevEnd = sortedByX[i - 1].x + sortedByX[i - 1].width;
        const gap = sortedByX[i].x - prevEnd;
        if (gap > 0) {
          allGaps.push(gap);
        }
      }
    }

    // Segment each row into cells
    for (const row of rowGroups) {
      globalLineNumber++;
      const sortedByX = [...row].sort((a, b) => a.x - b.x);
      const avgY = row.reduce((sum, t) => sum + t.y, 0) / row.length;

      // Determine cell gap threshold
      let gapThreshold = minGapForCell;
      if (dynamicGap && allGaps.length > 5) {
        const sortedGaps = [...allGaps].sort((a, b) => a - b);
        const medianIdx = Math.floor(sortedGaps.length / 2);
        const median = sortedGaps[medianIdx];
        gapThreshold = Math.max(minGapForCell, median * gapMultiplier);
      }

      // Build cells
      const cells: string[] = [];
      let currentCell = '';
      let lastEnd = sortedByX[0]?.x ?? 0;

      for (let i = 0; i < sortedByX.length; i++) {
        const token = sortedByX[i];
        const gap = token.x - lastEnd;

        if (i === 0) {
          currentCell = token.str;
        } else if (gap > gapThreshold) {
          // New cell
          cells.push(currentCell.trim());
          currentCell = token.str;
        } else {
          // Same cell - add space if there's a small gap
          if (gap > 2) {
            currentCell += ' ' + token.str;
          } else {
            currentCell += token.str;
          }
        }

        lastEnd = token.x + token.width;
      }

      if (currentCell.trim()) {
        cells.push(currentCell.trim());
      }

      // Build raw text
      const raw = cells.join('\t');

      if (raw.trim()) {
        allRows.push({
          raw,
          cells,
          page: pageNum,
          lineNumber: globalLineNumber,
          y: avgY,
        });
      }
    }
  }

  // Calculate stats
  const sortedGaps = [...allGaps].sort((a, b) => a - b);
  const medianGapX = sortedGaps.length > 0
    ? sortedGaps[Math.floor(sortedGaps.length / 2)]
    : 0;

  const totalCells = allRows.reduce((sum, r) => sum + r.cells.length, 0);
  const avgCellsPerRow = allRows.length > 0 ? totalCells / allRows.length : 0;

  return {
    rows: allRows,
    stats: {
      totalPages: tokensByPage.size,
      totalTokens: tokens.length,
      totalRows: allRows.length,
      avgCellsPerRow: Math.round(avgCellsPerRow * 100) / 100,
      medianGapX: Math.round(medianGapX * 100) / 100,
    },
  };
}

/**
 * Full pipeline: extract tokens and convert to rows
 */
export async function extractPdfLayoutRows(
  buffer: Buffer,
  config: LayoutExtractionConfig = {},
): Promise<{ rows: PdfRow[]; stats: LayoutExtractionStats }> {
  const tokens = await extractPdfTokens(buffer);
  return tokensToRows(tokens, config);
}

/**
 * Extract layout rows from file path
 */
export async function extractPdfLayoutRowsFromFile(
  pdfPath: string,
  config: LayoutExtractionConfig = {},
): Promise<{ rows: PdfRow[]; stats: LayoutExtractionStats }> {
  const buffer = await fs.readFile(pdfPath);
  return extractPdfLayoutRows(buffer, config);
}
