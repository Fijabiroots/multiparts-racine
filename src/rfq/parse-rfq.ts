import { z } from 'zod';

export const RfqLineSchema = z.object({
  lineNo: z.number(),
  qty: z.number().nullable(),
  uom: z.string().nullable(),
  itemCode: z.string().nullable(),
  partNumber: z.string().nullable(),
  description: z.string().nullable(),
  raw: z.string(),
});

export const RfqDocSchema = z.object({
  sourceFile: z.string(),
  docType: z.enum(['PR_RQ', 'PURCHASE_REQUISITION', 'UNKNOWN']),
  prNumber: z.string().nullable(),
  creationDate: z.string().nullable(),
  requestor: z.string().nullable(),
  deliveryLocation: z.string().nullable(),
  requiredBy: z.string().nullable(),
  priority: z.string().nullable(),
  generalDescription: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(RfqLineSchema),
  pagesUsedOcr: z.array(z.number()),
});

export type RfqLine = z.infer<typeof RfqLineSchema>;
export type RfqDoc = z.infer<typeof RfqDocSchema>;

function pickFirst(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Les tableaux dans les PDFs sont souvent "aplatis" en texte.
 * On capture les lignes qui commencent par un numéro de ligne (10, 20, 30, …)
 * puis on tente de splitter par colonnes "probables".
 */
function extractLinesFromText(fullText: string): string[] {
  const normalized = fullText.replace(/\r/g, '');

  // Exemple: "10 3 EA Seat cover Hilux Dual Cab"
  // On repère les débuts de lignes: \n10\s, \n20\s etc
  const candidates = normalized
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return candidates.filter((s) => /^\d{1,3}\s+/.test(s));
}

function parseLineRow(raw: string): RfqLine | null {
  // Heuristique multi-modèles:
  // PR_RQ:  "10 3 EA 710 0321 TRANSMISSION ASSY"  (itemCode parfois multi token)
  // PURCHASE_REQUISITION: "10 10 EA 201368 RELAY ... SCHNEIDER LRD325 ..."
  const parts = raw.trim().split(/\s+/);

  const lineNo = Number(parts[0]);
  if (!Number.isFinite(lineNo)) return null;

  // qty
  const qty = Number(parts[1]);
  const qtyVal = Number.isFinite(qty) ? qty : null;

  // uom
  const uom = parts[2] ?? null;

  // Le reste est variable. On tente itemCode si token numérique court
  // itemCode peut être "710" ou "201368" ou vide.
  let idx = 3;

  let itemCode: string | null = null;
  if (parts[idx] && /^[A-Za-z0-9\-]{2,}$/.test(parts[idx])) {
    // si le token ressemble à un code court / numérique
    if (
      /^\d{3,}$/.test(parts[idx]) ||
      /^[A-Za-z]{1,5}\d{1,}$/.test(parts[idx])
    ) {
      itemCode = parts[idx];
      idx++;
    }
  }

  // part number: souvent contient "-" ou "/" ou pattern like "KI38822-0004-1"
  let partNumber: string | null = null;
  if (parts[idx] && /[-/]/.test(parts[idx])) {
    partNumber = parts[idx];
    idx++;
  }

  const description = parts.slice(idx).join(' ').trim() || null;

  return {
    lineNo,
    qty: qtyVal,
    uom,
    itemCode,
    partNumber,
    description,
    raw,
  };
}

export function parseRfqFromPages(
  sourceFile: string,
  pages: { page: number; text: string; ocrUsed: boolean }[],
): RfqDoc {
  const fullText = pages.map((p) => p.text).join('\n');

  const docType: RfqDoc['docType'] = /REQUEST FOR QUOTATION|PR-\d+/i.test(
    fullText,
  )
    ? 'PR_RQ'
    : /PURCHASE REQUISITION|Purchase Requisitions No/i.test(fullText)
      ? 'PURCHASE_REQUISITION'
      : 'UNKNOWN';

  // Champs communs / variables
  const prNumber = pickFirst(fullText, [
    /REQUEST FOR QUOTATION\s*\n\s*(PR-\d+)/i,
    /\b(PR-\d{2,5})\b/i,
    /Purchase Requisitions No:\s*([0-9]{6,})/i,
    /Purchase Requisition No[:\s]*([0-9]{6,})/i,
  ]);

  const creationDate = pickFirst(fullText, [
    /Creation Date:\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{2,4})/i,
    /Creation Date:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{2,4})/i,
    /Purchase Requisitions No:\s*\d+\s*Creation Date:\s*([0-9]{2}-[A-Z]{3}-[0-9]{2})/i,
  ]);

  const requestor = pickFirst(fullText, [/Requestor:\s*([A-Za-zÀ-ÿ' ]+)/i]);

  const deliveryLocation = pickFirst(fullText, [
    /Delivery Loc\.\s*:\s*([^\n]+)/i,
    /Delivery Loc:\s*([^\n]+)/i,
    /Delivery Location:\s*([^\n]+)/i,
  ]);

  const requiredBy = pickFirst(fullText, [/Required by:\s*([^\n]+)/i]);
  const priority = pickFirst(fullText, [/Priority\s*([A-Za-z]+)/i]);

  const generalDescription = pickFirst(fullText, [
    /General Description:\s*([^\n]+)/i,
    /General Description:\s*\n\s*([^\n]+)/i,
  ]);

  const currency = pickFirst(fullText, [/\b(USD|EUR|XOF|CFA)\b/i]);

  const rawLineRows = extractLinesFromText(fullText);
  const lines = rawLineRows
    .map(parseLineRow)
    .filter((x): x is NonNullable<typeof x> => !!x);

  const pagesUsedOcr = pages.filter((p) => p.ocrUsed).map((p) => p.page);

  return RfqDocSchema.parse({
    sourceFile,
    docType,
    prNumber,
    creationDate,
    requestor: requestor ?? null,
    deliveryLocation: deliveryLocation ?? null,
    requiredBy: requiredBy ?? null,
    priority: priority ?? null,
    generalDescription: generalDescription ?? null,
    currency: currency ?? null,
    lines,
    pagesUsedOcr,
  });
}

/**
 * Version simplifiée qui parse directement depuis du texte brut
 */
export function parseRfqFromText(sourceFile: string, text: string): RfqDoc {
  return parseRfqFromPages(sourceFile, [
    { page: 1, text, ocrUsed: false },
  ]);
}
