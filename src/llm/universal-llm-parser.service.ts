import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CreditMonitorService } from './credit-monitor.service';

// ============================================================
// SCHÉMA CANONIQUE UNIVERSEL
// Tous les documents (FR/EN, tous clients) mappés vers ce schéma
// ============================================================

export interface CanonicalLineItem {
  line_number: number;
  quantity: number;
  unit_of_measure: string;
  item_code?: string;
  part_number?: string;
  description: string;
  brand?: string;
  unit_price?: number;
  total_price?: number;
  currency?: string;
  gl_code?: string;
  cost_center?: string;
  notes?: string;
}

export interface CanonicalDocument {
  // Métadonnées d'extraction
  _meta: {
    detected_language: 'fr' | 'en' | 'mixed';
    detected_type: 'RFQ' | 'PR' | 'PO' | 'QUOTE' | 'INVOICE' | 'UNKNOWN';
    confidence_score: number;
    extraction_method: 'llm' | 'regex' | 'hybrid';
    source_filename?: string;
    warnings: string[];
  };

  // Identification
  document_number: string;
  document_date?: string;
  
  // Parties
  buyer?: {
    company_name?: string;
    contact_name?: string;
    email?: string;
    address?: string;
  };
  supplier?: {
    company_name?: string;
    contact_name?: string;
    email?: string;
  };
  
  // Logistique
  delivery_location?: string;
  delivery_date?: string;
  priority?: string;
  
  // Contexte métier
  general_description?: string;
  project_code?: string;
  cost_center?: string;
  requestor?: string;
  approver?: string;
  
  // Articles
  items: CanonicalLineItem[];
  
  // Totaux
  subtotal?: number;
  tax_amount?: number;
  total_amount?: number;
  currency?: string;
}

export interface UniversalParserOptions {
  // Contexte tenant (optionnel - améliore la précision)
  tenantHints?: {
    companyName?: string;
    knownItemCodePattern?: string; // ex: "\\d{6}" pour codes 6 chiffres
    knownGlCodePattern?: string;
    preferredLanguage?: 'fr' | 'en';
  };
  documentType?: 'pdf' | 'excel' | 'word' | 'email';
  sourceFilename?: string;
  maxRetries?: number;
}

@Injectable()
export class UniversalLlmParserService implements OnModuleInit {
  private readonly logger = new Logger(UniversalLlmParserService.name);
  private anthropic: Anthropic | null = null;
  private isConfigured = false;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => CreditMonitorService))
    private creditMonitor: CreditMonitorService,
  ) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.isConfigured = true;
      this.logger.log('✅ Universal LLM Parser initialisé');
    } else {
      this.logger.warn('⚠️ ANTHROPIC_API_KEY non configurée');
    }
  }

  isAvailable(): boolean {
    return this.isConfigured && this.anthropic !== null;
  }

  /**
   * Parse universel - détecte automatiquement langue, type, et extrait les données
   */
  async parseDocument(
    content: string | Buffer,
    options: UniversalParserOptions = {}
  ): Promise<CanonicalDocument> {
    if (!this.isAvailable()) {
      return this.emptyDocument('LLM non disponible');
    }

    const { maxRetries = 2, sourceFilename } = options;
    
    // Si Buffer (PDF), on suppose que le texte a déjà été extrait
    const textContent = typeof content === 'string' 
      ? content 
      : content.toString('utf-8');

    // Tronquer si trop long
    const truncatedText = textContent.length > 20000
      ? textContent.substring(0, 20000) + '\n... [DOCUMENT TRONQUÉ]'
      : textContent;

    const systemPrompt = this.buildUniversalSystemPrompt(options);
    const userPrompt = this.buildUserPrompt(truncatedText, options);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Tentative ${attempt}/${maxRetries}`);

        const response = await this.anthropic!.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        this.creditMonitor.resetStatus();

        const content = response.content[0];
        if (content.type !== 'text') {
          throw new Error('Réponse inattendue');
        }

        const result = this.parseResponse(content.text, options);
        
        this.logger.log(
          `✅ Extraction: ${result.items.length} items, ` +
          `type=${result._meta.detected_type}, ` +
          `lang=${result._meta.detected_language}, ` +
          `confiance=${result._meta.confidence_score}%`
        );

        return result;

      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Tentative ${attempt} échouée: ${lastError.message}`);

        // Vérifier erreur de crédit et notifier
        await this.creditMonitor.checkApiError(error);

        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    return this.emptyDocument(`Erreur après ${maxRetries} tentatives: ${lastError?.message}`);
  }

  /**
   * Prompt système UNIVERSEL - pas de patterns spécifiques client
   */
  private buildUniversalSystemPrompt(options: UniversalParserOptions): string {
    const hints = options.tenantHints;
    
    let contextHints = '';
    if (hints) {
      contextHints = `
CONTEXTE CLIENT (indices optionnels):
- Entreprise: ${hints.companyName || 'Non spécifié'}
- Pattern codes articles: ${hints.knownItemCodePattern || 'Variable'}
- Pattern codes GL: ${hints.knownGlCodePattern || 'Variable'}
- Langue préférée: ${hints.preferredLanguage || 'Auto-détection'}
`;
    }

    return `Tu es un expert en extraction de données de documents commerciaux et d'achats.
Tu dois parser des documents de DIFFÉRENTS CLIENTS avec des formats VARIÉS.

TYPES DE DOCUMENTS À RECONNAÎTRE:
- RFQ / Demande de devis / Request for Quotation
- PR / Demande d'achat / Purchase Requisition  
- PO / Bon de commande / Purchase Order
- QUOTE / Devis / Quotation
- INVOICE / Facture / Invoice

LANGUES: Les documents peuvent être en FRANÇAIS, ANGLAIS, ou MIXTE.

MAPPING DES CHAMPS (FR → EN):
- "Numéro de demande" / "N° PR" / "Purchase Requisition No" → document_number
- "Date de création" / "Creation Date" → document_date
- "Lieu de livraison" / "Delivery Location" → delivery_location
- "Date de livraison" / "Required by" / "Delivery Date" → delivery_date
- "Demandeur" / "Requestor" → requestor
- "Priorité" / "Priority" → priority
- "Description générale" / "General Description" → general_description
- "Quantité" / "Qty" / "Quantity" → quantity
- "Unité" / "UOM" / "Unit" → unit_of_measure
- "Code article" / "Item Code" / "Référence" → item_code
- "N° pièce" / "Part Number" → part_number
- "Désignation" / "Description" / "Item Description" → description
- "Prix unitaire" / "Unit Price" / "Unit Cost" → unit_price
- "Montant" / "Line Cost" / "Total" → total_price
- "Code GL" / "GL Code" / "Compte" → gl_code
${contextHints}

RÈGLES D'EXTRACTION:
1. DÉTECTE d'abord la langue dominante (fr/en/mixed)
2. IDENTIFIE le type de document (RFQ, PR, PO, QUOTE, INVOICE)
3. EXTRAIS tous les items du tableau principal
4. NORMALISE les unités: EA/PCS/EACH → "pcs", KG → "kg", M → "m", etc.
5. Les quantités sont des nombres raisonnables (1-10000 typiquement)
6. IGNORE les en-têtes répétés, pieds de page, mentions légales
7. Si un champ n'existe pas, utilise null

EXTRACTION DES RÉFÉRENCES FOURNISSEUR (part_number):
Si la description contient une marque suivie d'un code alphanumérique, extrais ce code comme part_number.

Exemple: "BLOCK DISTR 250A SP APPLIED UKK250A"
- brand: "APPLIED"
- part_number: "UKK250A" (le code après la marque)
- description: "BLOCK DISTR 250A SP" (sans la marque et le part_number)

Patterns courants:
- "... BRAND PARTNUMBER" → extraire PARTNUMBER
- "... BRAND MODEL-123" → extraire MODEL-123
- Le part_number est généralement un code court (3-15 caractères alphanumériques)
- item_code = code interne client (ex: 135382)
- part_number = référence fournisseur/fabricant (ex: UKK250A, RTD6X1350)

ATTENTION CRITIQUE - NUMÉROS DE LIGNE vs QUANTITÉS:
Les documents Purchase Requisition ont souvent une colonne "Line" avec des numéros séquentiels (10, 20, 30, 40...).
Ces numéros de ligne NE SONT PAS des quantités !

Exemple de tableau PDF:
| Line | Qty | UOM | Item Code | Description |
|------|-----|-----|-----------|-------------|
| 10   | 5   | EA  | 201368    | RELAY...    |
| 20   | 3   | EA  | 201369    | FILTER...   |

Dans cet exemple:
- "10" et "20" sont des NUMÉROS DE LIGNE (à stocker dans line_number)
- "5" et "3" sont les VRAIES QUANTITÉS (à stocker dans quantity)

Règles quantités:
1. Si tu vois des nombres comme 10, 20, 30, 40... en première colonne, ce sont des numéros de ligne
2. La quantité est généralement un petit nombre (1-100)
3. Les quantités de 10, 20, 30 exactement sont suspectes - vérifie que ce n'est pas un numéro de ligne
4. Cherche la colonne "Qty" ou "Quantity" pour la vraie quantité

RETOURNE UNIQUEMENT un JSON valide avec cette structure:
{
  "_meta": {
    "detected_language": "fr" | "en" | "mixed",
    "detected_type": "RFQ" | "PR" | "PO" | "QUOTE" | "INVOICE" | "UNKNOWN",
    "confidence_score": 0-100,
    "warnings": ["warning1", ...]
  },
  "document_number": "string",
  "document_date": "string ou null",
  "delivery_location": "string ou null",
  "delivery_date": "string ou null",
  "priority": "string ou null",
  "general_description": "string ou null",
  "requestor": "string ou null",
  "approver": "string ou null",
  "buyer": { "company_name": "...", "contact_name": "..." } ou null,
  "supplier": { "company_name": "...", ... } ou null,
  "items": [
    {
      "line_number": 10,
      "quantity": 5,
      "unit_of_measure": "pcs",
      "item_code": "123456",
      "part_number": "ABC-123",
      "description": "Description complète",
      "brand": "MARQUE",
      "unit_price": 100.00,
      "total_price": 500.00,
      "currency": "USD",
      "gl_code": "1500405"
    }
  ],
  "total_amount": 1000.00,
  "currency": "USD"
}`;
  }

  private buildUserPrompt(text: string, options: UniversalParserOptions): string {
    let context = '';
    
    if (options.sourceFilename) {
      context += `Fichier source: ${options.sourceFilename}\n`;
    }
    if (options.documentType) {
      context += `Format: ${options.documentType.toUpperCase()}\n`;
    }

    return `${context}
CONTENU DU DOCUMENT:
---
${text}
---

Analyse ce document et extrais TOUTES les informations structurées.
Détecte automatiquement la langue et le type de document.
Réponds UNIQUEMENT avec le JSON, sans markdown ni commentaires.`;
  }

  private parseResponse(
    responseText: string, 
    options: UniversalParserOptions
  ): CanonicalDocument {
    const warnings: string[] = [];

    // Nettoyer JSON
    let cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleanJson);

      // Valider et normaliser les items
      const items: CanonicalLineItem[] = (parsed.items || [])
        .filter((item: any) => this.isValidItem(item))
        .map((item: any, index: number) => this.normalizeItem(item, index));

      const rejectedCount = (parsed.items || []).length - items.length;
      if (rejectedCount > 0) {
        warnings.push(`${rejectedCount} item(s) invalide(s) ignoré(s)`);
      }

      return {
        _meta: {
          detected_language: parsed._meta?.detected_language || 'mixed',
          detected_type: parsed._meta?.detected_type || 'UNKNOWN',
          confidence_score: Math.min(100, Math.max(0, parsed._meta?.confidence_score || 50)),
          extraction_method: 'llm',
          source_filename: options.sourceFilename,
          warnings: [...(parsed._meta?.warnings || []), ...warnings],
        },
        document_number: parsed.document_number || 'UNKNOWN',
        document_date: parsed.document_date,
        buyer: parsed.buyer,
        supplier: parsed.supplier,
        delivery_location: parsed.delivery_location,
        delivery_date: parsed.delivery_date,
        priority: parsed.priority,
        general_description: parsed.general_description,
        requestor: parsed.requestor,
        approver: parsed.approver,
        project_code: parsed.project_code,
        cost_center: parsed.cost_center,
        items,
        subtotal: parsed.subtotal,
        tax_amount: parsed.tax_amount,
        total_amount: parsed.total_amount,
        currency: parsed.currency,
      };

    } catch (error) {
      this.logger.error(`Erreur parsing JSON: ${error}`);
      return this.emptyDocument(`Erreur parsing: ${(error as Error).message}`);
    }
  }

  private isValidItem(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    
    const hasIdentifier = item.item_code || item.part_number || item.description;
    if (!hasIdentifier) return false;

    if (item.quantity !== undefined) {
      const qty = parseFloat(item.quantity);
      if (isNaN(qty) || qty <= 0 || qty > 100000) return false;
    }

    return true;
  }

  private normalizeItem(item: any, index: number): CanonicalLineItem {
    return {
      line_number: item.line_number || (index + 1) * 10,
      quantity: this.parseNumber(item.quantity, 1) ?? 1,
      unit_of_measure: this.normalizeUnit(item.unit_of_measure || item.unit),
      item_code: item.item_code || undefined,
      part_number: item.part_number || undefined,
      description: (item.description || '').trim(),
      brand: item.brand?.toUpperCase() || undefined,
      unit_price: this.parseNumber(item.unit_price),
      total_price: this.parseNumber(item.total_price),
      currency: item.currency?.toUpperCase() || undefined,
      gl_code: item.gl_code || undefined,
      cost_center: item.cost_center || undefined,
      notes: item.notes || undefined,
    };
  }

  private parseNumber(value: any, defaultValue?: number): number | undefined {
    if (value === null || value === undefined) return defaultValue;
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    return isNaN(num) ? defaultValue : num;
  }

  private normalizeUnit(unit: string | undefined): string {
    if (!unit) return 'pcs';
    
    const normalized = unit.toUpperCase().trim();
    
    const unitMap: Record<string, string> = {
      'EA': 'pcs', 'EACH': 'pcs', 'PCS': 'pcs', 'PC': 'pcs',
      'PIECE': 'pcs', 'PIECES': 'pcs', 'UNIT': 'pcs', 'UNITS': 'pcs',
      'KG': 'kg', 'KILOGRAM': 'kg',
      'M': 'm', 'METER': 'm', 'METRE': 'm', 'METTRE': 'm',
      'L': 'l', 'LITER': 'l', 'LITRE': 'l',
      'LOT': 'lot', 'SET': 'set', 'ROLL': 'roll', 'BOX': 'box',
    };

    return unitMap[normalized] || unit.toLowerCase();
  }

  private emptyDocument(warning: string): CanonicalDocument {
    return {
      _meta: {
        detected_language: 'mixed',
        detected_type: 'UNKNOWN',
        confidence_score: 0,
        extraction_method: 'llm',
        warnings: [warning],
      },
      document_number: 'UNKNOWN',
      items: [],
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
