import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

// pdfjs-dist (Node build)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PageText = { page: number; text: string; ocrUsed: boolean };

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
