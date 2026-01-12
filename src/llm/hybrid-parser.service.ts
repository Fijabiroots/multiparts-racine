import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UniversalLlmParserService, CanonicalDocument, CanonicalLineItem, UniversalParserOptions } from './universal-llm-parser.service';

/**
 * Service hybride qui combine:
 * 1. Extraction regex rapide (gratuit, ~10ms)
 * 2. LLM comme fallback intelligent (précis, ~2s, payant)
 * 
 * Stratégie:
 * - Si regex trouve ≥3 items avec confiance ≥60% → retourner regex
 * - Sinon → appeler LLM
 * - Optionnel: fusionner regex + LLM pour meilleur résultat
 */
@Injectable()
export class HybridParserService {
  private readonly logger = new Logger(HybridParserService.name);
  
  // Seuils configurables
  private readonly minItemsForRegex: number;
  private readonly minConfidenceForRegex: number;
  private readonly mode: 'auto' | 'regex_only' | 'llm_only';

  constructor(
    private configService: ConfigService,
    private llmParser: UniversalLlmParserService,
  ) {
    this.minItemsForRegex = this.configService.get<number>('LLM_MIN_ITEMS_THRESHOLD', 3);
    this.minConfidenceForRegex = this.configService.get<number>('LLM_MIN_CONFIDENCE_THRESHOLD', 60);
    this.mode = this.configService.get<string>('LLM_MODE', 'auto') as any;
    
    this.logger.log(`Mode hybride: ${this.mode} (seuils: ${this.minItemsForRegex} items, ${this.minConfidenceForRegex}% confiance)`);
  }

  /**
   * Parse un document avec stratégie hybride
   */
  async parseDocument(
    rawText: string,
    options: UniversalParserOptions = {}
  ): Promise<CanonicalDocument> {
    const startTime = Date.now();

    // Mode forcé LLM
    if (this.mode === 'llm_only' && this.llmParser.isAvailable()) {
      this.logger.debug('Mode LLM forcé');
      return this.llmParser.parseDocument(rawText, options);
    }

    // Essayer regex d'abord
    const regexResult = this.extractWithRegex(rawText, options);
    const regexTime = Date.now() - startTime;
    
    this.logger.debug(
      `Regex: ${regexResult.items.length} items, ` +
      `confiance ${regexResult._meta.confidence_score}% (${regexTime}ms)`
    );

    // Mode regex only ou LLM non disponible
    if (this.mode === 'regex_only' || !this.llmParser.isAvailable()) {
      if (regexResult.items.length === 0) {
        regexResult._meta.warnings.push('LLM non disponible ou désactivé');
      }
      return regexResult;
    }

    // Vérifier si regex suffit
    const regexSufficient = 
      regexResult.items.length >= this.minItemsForRegex &&
      regexResult._meta.confidence_score >= this.minConfidenceForRegex;

    if (regexSufficient) {
      this.logger.log(
        `✅ Regex suffisant: ${regexResult.items.length} items, ` +
        `${regexResult._meta.confidence_score}% confiance`
      );
      return regexResult;
    }

    // Appeler LLM comme fallback
    this.logger.log(
      `Regex insuffisant (${regexResult.items.length} items, ` +
      `${regexResult._meta.confidence_score}%), passage au LLM...`
    );

    const llmResult = await this.llmParser.parseDocument(rawText, options);
    const totalTime = Date.now() - startTime;

    this.logger.log(
      `✅ LLM: ${llmResult.items.length} items, ` +
      `${llmResult._meta.confidence_score}% confiance (${totalTime}ms total)`
    );

    // Si les deux ont des résultats, on peut fusionner
    if (regexResult.items.length > 0 && llmResult.items.length > 0) {
      return this.mergeResults(regexResult, llmResult);
    }

    // Retourner le meilleur résultat
    return llmResult.items.length > 0 ? llmResult : regexResult;
  }

  /**
   * Extraction avec patterns regex (rapide, gratuit)
   */
  private extractWithRegex(
    text: string, 
    options: UniversalParserOptions
  ): CanonicalDocument {
    const items: CanonicalLineItem[] = [];
    const warnings: string[] = [];
    let confidence = 0;

    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Détecter la langue
    const language = this.detectLanguage(cleanText);
    
    // Détecter le type de document
    const docType = this.detectDocumentType(cleanText);
    if (docType !== 'UNKNOWN') confidence += 15;

    // Extraire le numéro de document
    const docNumber = this.extractDocumentNumber(cleanText, options.sourceFilename);
    if (docNumber) confidence += 10;

    // ========================================
    // PATTERNS D'EXTRACTION
    // ========================================

    // Pattern 1: Format Endeavour Mining compact
    // "1010EA201368RELAY OVERLOAD...1500405"
    const endeavourPattern = /(\d{1,4})(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)(\d{5,8})([A-Z][A-Z0-9\s\-\.\/\&\,\(\)\:]+?)(?:\s*1500\d{3}|$)/gi;
    
    let match;
    while ((match = endeavourPattern.exec(cleanText)) !== null) {
      const lineAndQty = match[1];
      const unit = match[2];
      const itemCode = match[3];
      let description = match[4].trim();
      
      // Extraire qty (derniers 1-2 chiffres si < 100)
      const qty = lineAndQty.length <= 2 
        ? parseInt(lineAndQty, 10) 
        : parseInt(lineAndQty.slice(-2), 10) || 1;
      
      description = this.cleanDescription(description);
      
      if (description.length > 5 && qty > 0 && qty <= 1000) {
        items.push({
          line_number: items.length * 10 + 10,
          quantity: qty,
          unit_of_measure: this.normalizeUnit(unit),
          item_code: itemCode,
          description,
        });
        confidence += 8;
      }
    }

    // Pattern 2: Format avec espaces
    // "10 10 EA 201368 RELAY OVERLOAD"
    if (items.length === 0) {
      const spacedPattern = /\b(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s+1500\d+|\s*$)/gi;
      
      while ((match = spacedPattern.exec(cleanText)) !== null) {
        const qty = parseInt(match[2], 10);
        const unit = match[3];
        const itemCode = match[4];
        let description = match[5].trim();
        
        description = this.cleanDescription(description);
        
        if (description.length > 5 && qty > 0 && qty <= 1000) {
          items.push({
            line_number: items.length * 10 + 10,
            quantity: qty,
            unit_of_measure: this.normalizeUnit(unit),
            item_code: itemCode,
            description,
          });
          confidence += 8;
        }
      }
    }

    // Pattern 3: Format générique "CODE - Description - Qty"
    if (items.length === 0) {
      const genericPattern = /\b([A-Z0-9]{5,10})\s*[-:]\s*([A-Z][A-Z0-9\s\-\.\/\&\,]+?)\s*[-:]\s*(\d+)\s*(EA|PCS|PC|KG|M)?/gi;
      
      while ((match = genericPattern.exec(cleanText)) !== null) {
        const code = match[1];
        let description = match[2].trim();
        const qty = parseInt(match[3], 10);
        const unit = match[4] || 'EA';
        
        // Ignorer si c'est un code GL
        if (code.startsWith('1500')) continue;
        
        description = this.cleanDescription(description);
        
        if (description.length > 5 && qty > 0 && qty <= 1000) {
          items.push({
            line_number: items.length * 10 + 10,
            quantity: qty,
            unit_of_measure: this.normalizeUnit(unit),
            item_code: code,
            description,
          });
          confidence += 5;
        }
      }
    }

    // Ajuster confiance
    confidence = Math.min(100, confidence);
    
    if (items.length === 0) {
      warnings.push('Aucun pattern regex ne correspond');
      confidence = 0;
    } else if (items.length < this.minItemsForRegex) {
      warnings.push(`Seulement ${items.length} item(s) trouvé(s)`);
    }

    return {
      _meta: {
        detected_language: language,
        detected_type: docType,
        confidence_score: confidence,
        extraction_method: 'regex',
        source_filename: options.sourceFilename,
        warnings,
      },
      document_number: docNumber || 'UNKNOWN',
      items,
    };
  }

  /**
   * Fusionne les résultats regex et LLM
   */
  private mergeResults(
    regexResult: CanonicalDocument,
    llmResult: CanonicalDocument
  ): CanonicalDocument {
    // Utiliser LLM comme base (plus fiable pour métadonnées)
    const merged = { ...llmResult };
    
    // Ajouter items regex non présents dans LLM
    const llmItemCodes = new Set(llmResult.items.map(i => i.item_code).filter(Boolean));
    
    for (const regexItem of regexResult.items) {
      if (regexItem.item_code && !llmItemCodes.has(regexItem.item_code)) {
        merged.items.push(regexItem);
      }
    }

    // Renuméroter les lignes
    merged.items = merged.items.map((item, index) => ({
      ...item,
      line_number: (index + 1) * 10,
    }));

    merged._meta.extraction_method = 'hybrid';
    merged._meta.warnings.push(
      `Fusion: ${regexResult.items.length} regex + ${llmResult.items.length} LLM = ${merged.items.length} items`
    );

    return merged;
  }

  // ========================================
  // UTILITAIRES
  // ========================================

  private detectLanguage(text: string): 'fr' | 'en' | 'mixed' {
    const frKeywords = ['demande', 'achat', 'quantité', 'désignation', 'fournisseur', 'livraison'];
    const enKeywords = ['purchase', 'requisition', 'quantity', 'description', 'supplier', 'delivery'];
    
    const textLower = text.toLowerCase();
    const frCount = frKeywords.filter(kw => textLower.includes(kw)).length;
    const enCount = enKeywords.filter(kw => textLower.includes(kw)).length;
    
    if (frCount > enCount + 1) return 'fr';
    if (enCount > frCount + 1) return 'en';
    return 'mixed';
  }

  private detectDocumentType(text: string): CanonicalDocument['_meta']['detected_type'] {
    const textLower = text.toLowerCase();
    
    if (textLower.includes('purchase requisition') || textLower.includes('demande d\'achat')) {
      return 'PR';
    }
    if (textLower.includes('request for quotation') || textLower.includes('demande de devis') || textLower.includes('rfq')) {
      return 'RFQ';
    }
    if (textLower.includes('purchase order') || textLower.includes('bon de commande')) {
      return 'PO';
    }
    if (textLower.includes('quotation') || textLower.includes('devis')) {
      return 'QUOTE';
    }
    if (textLower.includes('invoice') || textLower.includes('facture')) {
      return 'INVOICE';
    }
    
    return 'UNKNOWN';
  }

  private extractDocumentNumber(text: string, filename?: string): string | undefined {
    // Patterns dans le texte
    const patterns = [
      /Purchase\s+Requisitions?\s+No[:\s]*([A-Z]*-?\d+)/i,
      /PR[\s\-_]*(\d{6,})/i,
      /RFQ[\s\-_#]*([A-Z0-9\-]+)/i,
      /N[°o]\s*(?:demande|commande)[:\s]*([A-Z0-9\-]+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].startsWith('PR') ? match[1] : `PR-${match[1]}`;
      }
    }
    
    // Pattern dans le nom de fichier
    if (filename) {
      const filenameMatch = filename.match(/PR[\s_\-]*(\d+)/i);
      if (filenameMatch) {
        return `PR-${filenameMatch[1]}`;
      }
    }
    
    return undefined;
  }

  private cleanDescription(desc: string): string {
    return desc
      .replace(/\s+1500\d+.*$/i, '')  // Enlever GL codes
      .replace(/\s+\d+\s+(USD|EUR|XOF).*$/i, '')  // Enlever prix
      .replace(/\s+0\s+0\s*$/i, '')  // Enlever zéros finaux
      .replace(/\s+/g, ' ')  // Normaliser espaces
      .trim();
  }

  private normalizeUnit(unit: string): string {
    const normalized = unit.toUpperCase().trim();
    
    const unitMap: Record<string, string> = {
      'EA': 'pcs', 'EACH': 'pcs', 'PCS': 'pcs', 'PC': 'pcs',
      'PIECE': 'pcs', 'PIECES': 'pcs', 'UNIT': 'pcs', 'UNITS': 'pcs',
      'KG': 'kg', 'M': 'm', 'L': 'l',
      'LOT': 'lot', 'SET': 'set',
    };

    return unitMap[normalized] || unit.toLowerCase();
  }
}
