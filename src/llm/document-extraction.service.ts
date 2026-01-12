import { Injectable, Logger } from '@nestjs/common';
import { UniversalLlmParserService, CanonicalDocument, UniversalParserOptions } from './universal-llm-parser.service';
import * as pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';

export interface DocumentInput {
  content: Buffer;
  filename: string;
  mimeType?: string;
}

export interface TenantConfig {
  tenantId: string;
  companyName: string;
  // Patterns spécifiques au tenant (optionnel - améliore la précision)
  itemCodePattern?: string;
  glCodePattern?: string;
  preferredLanguage?: 'fr' | 'en';
  // Champs custom du tenant
  customFields?: string[];
}

/**
 * Service orchestrateur qui:
 * 1. Détecte le format du document
 * 2. Extrait le texte brut
 * 3. Appelle le LLM universel
 * 4. Retourne un schéma canonique normalisé
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(private llmParser: UniversalLlmParserService) {}

  /**
   * Point d'entrée principal - parse n'importe quel document
   */
  async extractDocument(
    input: DocumentInput,
    tenantConfig?: TenantConfig
  ): Promise<CanonicalDocument> {
    const filename = input.filename.toLowerCase();
    
    // 1. Détecter le type et extraire le texte
    let rawText: string;
    let docType: 'pdf' | 'excel' | 'word' | 'email';

    try {
      if (filename.endsWith('.pdf')) {
        rawText = await this.extractPdfText(input.content);
        docType = 'pdf';
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        rawText = this.extractExcelText(input.content);
        docType = 'excel';
      } else if (filename.endsWith('.docx') || filename.endsWith('.doc')) {
        rawText = await this.extractWordText(input.content);
        docType = 'word';
      } else if (filename.endsWith('.eml') || filename.endsWith('.msg')) {
        rawText = input.content.toString('utf-8');
        docType = 'email';
      } else if (filename.endsWith('.txt') || filename.endsWith('.csv')) {
        rawText = input.content.toString('utf-8');
        docType = 'excel'; // Traiter CSV comme données tabulaires
      } else {
        // Tenter comme texte brut
        rawText = input.content.toString('utf-8');
        docType = 'pdf';
      }
    } catch (error) {
      this.logger.error(`Erreur extraction ${filename}: ${error}`);
      return this.errorDocument(filename, `Erreur extraction: ${(error as Error).message}`);
    }

    // Vérifier qu'on a du contenu
    if (!rawText || rawText.trim().length < 20) {
      this.logger.warn(`Contenu insuffisant: ${filename}`);
      return this.errorDocument(filename, 'Document vide ou contenu insuffisant');
    }

    this.logger.debug(`Extrait ${rawText.length} caractères de ${filename} (${docType})`);

    // 2. Construire les options avec contexte tenant
    const options: UniversalParserOptions = {
      documentType: docType,
      sourceFilename: input.filename,
    };

    if (tenantConfig) {
      options.tenantHints = {
        companyName: tenantConfig.companyName,
        knownItemCodePattern: tenantConfig.itemCodePattern,
        knownGlCodePattern: tenantConfig.glCodePattern,
        preferredLanguage: tenantConfig.preferredLanguage,
      };
    }

    // 3. Parser avec LLM universel
    const result = await this.llmParser.parseDocument(rawText, options);

    // 4. Enrichir les métadonnées
    result._meta.source_filename = input.filename;

    return result;
  }

  /**
   * Parse plusieurs documents en batch
   */
  async extractDocuments(
    inputs: DocumentInput[],
    tenantConfig?: TenantConfig
  ): Promise<CanonicalDocument[]> {
    const results: CanonicalDocument[] = [];

    for (const input of inputs) {
      try {
        const result = await this.extractDocument(input, tenantConfig);
        results.push(result);
      } catch (error) {
        this.logger.error(`Erreur batch ${input.filename}: ${error}`);
        results.push(this.errorDocument(input.filename, (error as Error).message));
      }
    }

    return results;
  }

  /**
   * Fusionne plusieurs documents en un seul résultat
   * Utile quand un email a plusieurs pièces jointes
   */
  async extractAndMerge(
    inputs: DocumentInput[],
    tenantConfig?: TenantConfig
  ): Promise<CanonicalDocument> {
    const documents = await this.extractDocuments(inputs, tenantConfig);
    
    if (documents.length === 0) {
      return this.errorDocument('batch', 'Aucun document à traiter');
    }

    if (documents.length === 1) {
      return documents[0];
    }

    // Fusionner les résultats
    const merged: CanonicalDocument = {
      _meta: {
        detected_language: this.detectDominantLanguage(documents),
        detected_type: this.detectDominantType(documents),
        confidence_score: Math.max(...documents.map(d => d._meta.confidence_score)),
        extraction_method: 'llm',
        source_filename: inputs.map(i => i.filename).join(', '),
        warnings: documents.flatMap(d => d._meta.warnings),
      },
      document_number: documents.find(d => d.document_number !== 'UNKNOWN')?.document_number || 'UNKNOWN',
      document_date: documents.find(d => d.document_date)?.document_date,
      delivery_location: documents.find(d => d.delivery_location)?.delivery_location,
      delivery_date: documents.find(d => d.delivery_date)?.delivery_date,
      priority: documents.find(d => d.priority)?.priority,
      general_description: documents.find(d => d.general_description)?.general_description,
      requestor: documents.find(d => d.requestor)?.requestor,
      buyer: documents.find(d => d.buyer)?.buyer,
      supplier: documents.find(d => d.supplier)?.supplier,
      items: this.mergeItems(documents),
      total_amount: documents.find(d => d.total_amount)?.total_amount,
      currency: documents.find(d => d.currency)?.currency,
    };

    merged._meta.warnings.push(`Fusion de ${documents.length} documents`);

    return merged;
  }

  // ============================================================
  // EXTRACTION DE TEXTE PAR FORMAT
  // ============================================================

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const pdfParseDefault = (pdfParse as any).default || pdfParse;
    const data = await pdfParseDefault(buffer);
    return data.text || '';
  }

  private extractExcelText(buffer: Buffer): string {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const texts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      
      // Convertir en CSV pour garder la structure tabulaire
      const csv = XLSX.utils.sheet_to_csv(sheet, { 
        blankrows: false,
        forceQuotes: false,
      });
      
      if (csv.trim()) {
        texts.push(`=== Feuille: ${sheetName} ===\n${csv}`);
      }
    }

    return texts.join('\n\n');
  }

  private async extractWordText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  // ============================================================
  // UTILITAIRES
  // ============================================================

  private mergeItems(documents: CanonicalDocument[]): CanonicalDocument['items'] {
    const allItems = documents.flatMap(d => d.items);
    const uniqueItems: CanonicalDocument['items'] = [];
    const seen = new Set<string>();

    for (const item of allItems) {
      // Clé de déduplication
      const key = `${item.item_code || ''}-${item.description.toLowerCase().substring(0, 30)}-${item.quantity}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    // Renuméroter les lignes
    return uniqueItems.map((item, index) => ({
      ...item,
      line_number: (index + 1) * 10,
    }));
  }

  private detectDominantLanguage(documents: CanonicalDocument[]): 'fr' | 'en' | 'mixed' {
    const langs = documents.map(d => d._meta.detected_language);
    const frCount = langs.filter(l => l === 'fr').length;
    const enCount = langs.filter(l => l === 'en').length;
    
    if (frCount > enCount) return 'fr';
    if (enCount > frCount) return 'en';
    return 'mixed';
  }

  private detectDominantType(documents: CanonicalDocument[]): CanonicalDocument['_meta']['detected_type'] {
    const types = documents.map(d => d._meta.detected_type).filter(t => t !== 'UNKNOWN');
    if (types.length === 0) return 'UNKNOWN';
    
    // Retourner le type le plus fréquent
    const counts = types.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as any;
  }

  private errorDocument(filename: string, error: string): CanonicalDocument {
    return {
      _meta: {
        detected_language: 'mixed',
        detected_type: 'UNKNOWN',
        confidence_score: 0,
        extraction_method: 'llm',
        source_filename: filename,
        warnings: [error],
      },
      document_number: 'UNKNOWN',
      items: [],
    };
  }
}
