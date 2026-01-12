import { Injectable, Logger } from '@nestjs/common';
import { CanonicalDocument, CanonicalLineItem } from './universal-llm-parser.service';
import { PriceRequestItem, PriceRequest, ExtractedDocumentData } from '../common/interfaces';

/**
 * Adaptateur pour convertir le schéma canonique universel
 * vers les interfaces existantes du projet (backward compatibility)
 */
@Injectable()
export class CanonicalAdapterService {
  private readonly logger = new Logger(CanonicalAdapterService.name);

  /**
   * Convertit un CanonicalDocument vers un tableau de PriceRequestItem
   * Compatible avec ExcelService.generatePriceRequestExcel()
   */
  toPriceRequestItems(doc: CanonicalDocument): PriceRequestItem[] {
    return doc.items.map((item, index) => this.toItem(item, doc, index));
  }

  /**
   * Convertit un CanonicalLineItem vers PriceRequestItem
   */
  private toItem(
    item: CanonicalLineItem,
    doc: CanonicalDocument,
    index: number
  ): PriceRequestItem {
    return {
      // Identifiants
      reference: item.part_number || item.item_code,
      internalCode: item.item_code,
      supplierCode: item.part_number,

      // Description (dédoublonnée si nécessaire)
      description: this.deduplicateDescription(item.description),
      brand: item.brand,
      
      // Quantité
      quantity: item.quantity,
      unit: item.unit_of_measure,
      
      // Prix (si disponible)
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
      currency: item.currency,
      
      // Notes enrichies avec contexte
      notes: this.buildNotes(item, doc),
      
      // Flags
      needsReview: doc._meta.confidence_score < 70,
    };
  }

  /**
   * Construit les notes enrichies
   */
  private buildNotes(item: CanonicalLineItem, doc: CanonicalDocument): string {
    const parts: string[] = [];
    
    if (item.notes) parts.push(item.notes);
    if (item.gl_code) parts.push(`GL: ${item.gl_code}`);
    if (item.cost_center) parts.push(`CC: ${item.cost_center}`);
    
    if (doc._meta.confidence_score < 70) {
      parts.push('⚠️ Vérification recommandée');
    }
    
    return parts.length > 0 ? parts.join(' | ') : '';
  }

  /**
   * Convertit un CanonicalDocument vers PriceRequest complet
   * Prêt pour ExcelService
   */
  toPriceRequest(
    doc: CanonicalDocument, 
    internalRfqNumber: string
  ): PriceRequest {
    return {
      requestNumber: internalRfqNumber,
      date: new Date(),
      
      // Client info depuis le document
      clientRfqNumber: doc.document_number !== 'UNKNOWN' ? doc.document_number : undefined,
      clientName: doc.buyer?.company_name,
      clientEmail: doc.buyer?.email,
      
      // Supplier info (si c'est une réponse à RFQ)
      supplier: doc.supplier?.company_name,
      supplierEmail: doc.supplier?.email,
      
      // Items convertis
      items: this.toPriceRequestItems(doc),
      
      // Deadline
      deadline: doc.delivery_date ? new Date(doc.delivery_date) : undefined,
      
      // Notes avec métadonnées d'extraction
      notes: this.buildRequestNotes(doc),
    };
  }

  /**
   * Construit les notes du PriceRequest
   */
  private buildRequestNotes(doc: CanonicalDocument): string {
    const parts: string[] = [];
    
    // Type et langue détectés
    parts.push(`Type: ${doc._meta.detected_type}, Langue: ${doc._meta.detected_language}`);
    
    // Confiance
    parts.push(`Confiance: ${doc._meta.confidence_score}%`);
    
    // Description générale
    if (doc.general_description) {
      parts.push(`Description: ${doc.general_description}`);
    }
    
    // Priorité
    if (doc.priority) {
      parts.push(`Priorité: ${doc.priority}`);
    }
    
    // Warnings
    if (doc._meta.warnings.length > 0) {
      parts.push(`⚠️ ${doc._meta.warnings.join(', ')}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Convertit vers l'ancien format ExtractedDocumentData
   * Compatible avec DocumentParserService
   */
  toExtractedDocumentData(doc: CanonicalDocument): ExtractedDocumentData {
    return {
      filename: doc._meta.source_filename || 'unknown',
      type: this.mapDocumentType(doc._meta.detected_type),
      text: '', // Le texte brut n'est pas conservé dans le schéma canonique
      items: this.toPriceRequestItems(doc),
      rfqNumber: doc.document_number !== 'UNKNOWN' ? doc.document_number : undefined,
      needsVerification: doc._meta.confidence_score < 70,
      extractionMethod: doc._meta.extraction_method,
      deadline: doc.delivery_date,
      contactName: doc.buyer?.contact_name || doc.requestor,
      isUrgent: doc.priority?.toLowerCase().includes('urgent'),
    };
  }

  /**
   * Mappe le type canonique vers le type legacy
   */
  private mapDocumentType(canonicalType: string): 'pdf' | 'excel' | 'word' | 'email' | 'image' {
    // Le type canonique (RFQ, PR, etc.) n'est pas le format de fichier
    // On retourne 'pdf' par défaut car c'est le plus courant
    return 'pdf';
  }

  /**
   * Supprime les descriptions doublées du type "ABC - ABC" ou "ABC / ABC"
   * Les PDFs Endeavour ont parfois la description répétée avec un séparateur
   */
  private deduplicateDescription(description: string): string {
    if (!description) return description;

    // Séparateurs courants
    const separators = [' - ', ' / ', ' | ', ' – ', ' — '];

    for (const sep of separators) {
      const parts = description.split(sep);
      if (parts.length === 2) {
        const first = parts[0].trim().toLowerCase();
        const second = parts[1].trim().toLowerCase();

        // Si les deux parties sont identiques ou quasi-identiques
        if (first === second) {
          return parts[0].trim();
        }

        // Vérifier si l'une est préfixe de l'autre (cas de troncature)
        if (first.startsWith(second) || second.startsWith(first)) {
          // Garder la plus longue
          return parts[0].length >= parts[1].length ? parts[0].trim() : parts[1].trim();
        }
      }
    }

    return description;
  }

  /**
   * Fusionne plusieurs CanonicalDocument en un seul PriceRequest
   */
  mergeToSinglePriceRequest(
    docs: CanonicalDocument[],
    internalRfqNumber: string
  ): PriceRequest {
    // Collecter tous les items
    const allItems: PriceRequestItem[] = [];
    const seenKeys = new Set<string>();
    
    for (const doc of docs) {
      for (const item of this.toPriceRequestItems(doc)) {
        const key = `${item.internalCode || ''}-${item.description?.toLowerCase().substring(0, 30)}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allItems.push(item);
        }
      }
    }

    // Trouver le meilleur document pour les métadonnées
    const bestDoc = docs
      .sort((a, b) => b._meta.confidence_score - a._meta.confidence_score)[0];

    const priceRequest = this.toPriceRequest(bestDoc, internalRfqNumber);
    priceRequest.items = allItems;
    
    return priceRequest;
  }
}
