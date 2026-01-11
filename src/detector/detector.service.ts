import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ParsedEmail } from '../common/interfaces';
import { DetectionKeyword } from '../database/entities';

export interface DetectionResult {
  isPriceRequest: boolean;
  confidence: number; // 0-100
  matchedKeywords: Array<{ keyword: string; location: 'subject' | 'body'; weight: number }>;
  hasRelevantAttachments: boolean;
  attachmentTypes: string[];
  reason: string;
}

@Injectable()
export class DetectorService {
  private readonly logger = new Logger(DetectorService.name);
  private keywords: DetectionKeyword[] = [];
  private readonly CONFIDENCE_THRESHOLD = 30; // Seuil minimum pour considérer comme demande de prix

  constructor(private readonly databaseService: DatabaseService) {
    this.loadKeywords();
  }

  private async loadKeywords() {
    try {
      this.keywords = await this.databaseService.getDetectionKeywords();
      this.logger.log(`${this.keywords.length} mots-clés de détection chargés`);
    } catch (error) {
      this.logger.error('Erreur chargement mots-clés:', error.message);
      // Utiliser des mots-clés par défaut si la DB n'est pas disponible
      this.keywords = this.getDefaultKeywords();
    }
  }

  async refreshKeywords() {
    await this.loadKeywords();
  }

  async analyzeEmail(email: ParsedEmail): Promise<DetectionResult> {
    if (this.keywords.length === 0) {
      await this.loadKeywords();
    }

    const matchedKeywords: DetectionResult['matchedKeywords'] = [];
    let totalScore = 0;

    const subjectLower = email.subject.toLowerCase();
    const bodyLower = email.body.toLowerCase();

    // ═══════════════════════════════════════════════════════════════════════
    // EXCLUSION: Bons de commande / Purchase Orders
    // ═══════════════════════════════════════════════════════════════════════
    const poExclusion = this.checkPurchaseOrderExclusion(subjectLower, bodyLower);
    if (poExclusion.isPurchaseOrder) {
      return {
        isPriceRequest: false,
        confidence: 0,
        matchedKeywords: [],
        hasRelevantAttachments: false,
        attachmentTypes: [],
        reason: `Exclu: ${poExclusion.reason}`,
      };
    }

    // Analyser chaque mot-clé
    for (const kw of this.keywords) {
      const keywordLower = kw.keyword.toLowerCase();

      // Vérifier dans le sujet
      if ((kw.type === 'subject' || kw.type === 'both') && subjectLower.includes(keywordLower)) {
        matchedKeywords.push({ keyword: kw.keyword, location: 'subject', weight: kw.weight });
        totalScore += kw.weight * 1.5; // Le sujet a plus de poids
      }

      // Vérifier dans le corps
      if ((kw.type === 'body' || kw.type === 'both') && bodyLower.includes(keywordLower)) {
        matchedKeywords.push({ keyword: kw.keyword, location: 'body', weight: kw.weight });
        totalScore += kw.weight;
      }
    }

    // Vérifier les pièces jointes
    const relevantExtensions = ['.pdf', '.xlsx', '.xls', '.docx', '.doc'];
    const attachmentTypes = email.attachments
      .map(att => {
        const ext = att.filename.substring(att.filename.lastIndexOf('.')).toLowerCase();
        return ext;
      })
      .filter(ext => relevantExtensions.includes(ext));

    const hasRelevantAttachments = attachmentTypes.length > 0;

    // Bonus pour pièces jointes pertinentes
    if (hasRelevantAttachments) {
      totalScore += 10;
    }

    // Calculer la confiance (0-100)
    const maxPossibleScore = this.keywords.reduce((sum, kw) => sum + kw.weight * 2.5, 0) + 10;
    const confidence = Math.min(100, Math.round((totalScore / maxPossibleScore) * 100 * 2));

    const isPriceRequest = confidence >= this.CONFIDENCE_THRESHOLD;

    let reason = '';
    if (isPriceRequest) {
      reason = `Détecté comme demande de prix (confiance: ${confidence}%). `;
      reason += `Mots-clés trouvés: ${matchedKeywords.map(m => m.keyword).join(', ')}.`;
      if (hasRelevantAttachments) {
        reason += ` Pièces jointes: ${attachmentTypes.join(', ')}.`;
      }
    } else {
      reason = `Non identifié comme demande de prix (confiance: ${confidence}%). `;
      if (matchedKeywords.length === 0) {
        reason += 'Aucun mot-clé de demande de prix trouvé.';
      } else {
        reason += `Score insuffisant malgré ${matchedKeywords.length} mot(s)-clé(s) trouvé(s).`;
      }
    }

    return {
      isPriceRequest,
      confidence,
      matchedKeywords,
      hasRelevantAttachments,
      attachmentTypes,
      reason,
    };
  }

  async analyzeEmails(emails: ParsedEmail[]): Promise<Array<{ email: ParsedEmail; detection: DetectionResult }>> {
    const results: Array<{ email: ParsedEmail; detection: DetectionResult }> = [];

    for (const email of emails) {
      const detection = await this.analyzeEmail(email);
      results.push({ email, detection });
    }

    return results;
  }

  async filterPriceRequestEmails(emails: ParsedEmail[]): Promise<ParsedEmail[]> {
    const analyzed = await this.analyzeEmails(emails);
    return analyzed
      .filter(item => item.detection.isPriceRequest)
      .map(item => item.email);
  }

  private getDefaultKeywords(): DetectionKeyword[] {
    return [
      { id: '1', keyword: 'demande de prix', weight: 10, language: 'fr', type: 'both' },
      { id: '2', keyword: 'demande de cotation', weight: 10, language: 'fr', type: 'both' },
      { id: '3', keyword: 'RFQ', weight: 10, language: 'both', type: 'both' },
      { id: '4', keyword: 'devis', weight: 8, language: 'fr', type: 'both' },
      { id: '5', keyword: 'cotation', weight: 8, language: 'fr', type: 'both' },
      { id: '6', keyword: 'offre de prix', weight: 9, language: 'fr', type: 'both' },
      { id: '7', keyword: 'request for quotation', weight: 10, language: 'en', type: 'both' },
      { id: '8', keyword: 'price request', weight: 9, language: 'en', type: 'both' },
      { id: '9', keyword: 'quote request', weight: 8, language: 'en', type: 'both' },
    ];
  }

  /**
   * Vérifie si l'email concerne un bon de commande (à exclure du traitement RFQ)
   */
  private checkPurchaseOrderExclusion(subject: string, body: string): { isPurchaseOrder: boolean; reason?: string } {
    const text = `${subject} ${body}`;

    // Mots-clés de bon de commande / purchase order
    const poKeywords = [
      // Français
      { pattern: /\bbon\s*de\s*commande\b/i, label: 'Bon de commande' },
      { pattern: /\bcommande\s*n[°o]?\s*\d+/i, label: 'Numéro de commande' },
      { pattern: /\bbc\s*n[°o]?\s*\d+/i, label: 'BC N°' },
      { pattern: /\bnotre\s*commande\b/i, label: 'Notre commande' },
      { pattern: /\bvotre\s*commande\b/i, label: 'Votre commande' },
      { pattern: /\bconfirmation\s*de\s*commande\b/i, label: 'Confirmation de commande' },
      { pattern: /\baccusé\s*de\s*réception\s*de\s*commande\b/i, label: 'Accusé de réception de commande' },
      { pattern: /\bsuivi\s*de\s*commande\b/i, label: 'Suivi de commande' },

      // Anglais
      { pattern: /\bpurchase\s*order\b/i, label: 'Purchase Order' },
      { pattern: /\bP\.?O\.?\s*#?\s*\d+/i, label: 'PO Number' },
      { pattern: /\bPO\s*number\b/i, label: 'PO Number' },
      { pattern: /\border\s*confirmation\b/i, label: 'Order confirmation' },
      { pattern: /\border\s*acknowledgment\b/i, label: 'Order acknowledgment' },
      { pattern: /\byour\s*order\b/i, label: 'Your order' },
      { pattern: /\bour\s*order\b/i, label: 'Our order' },

      // Patterns spécifiques dans le sujet (plus strict)
      { pattern: /^(?:re:\s*)?(?:fw:\s*)?(?:tr:\s*)?\[?PO\b/i, label: 'Sujet commence par PO', subjectOnly: true },
    ];

    // Vérifier les patterns
    for (const kw of poKeywords) {
      const searchText = kw.subjectOnly ? subject : text;
      if (kw.pattern.test(searchText)) {
        return { isPurchaseOrder: true, reason: `${kw.label} détecté` };
      }
    }

    // Vérifier les pièces jointes mentionnées qui suggèrent une commande
    const poAttachmentPatterns = [
      /bon\s*de\s*commande.*\.pdf/i,
      /purchase.*order.*\.pdf/i,
      /PO[-_]?\d+\.pdf/i,
      /commande[-_]?\d+\.pdf/i,
    ];

    for (const pattern of poAttachmentPatterns) {
      if (pattern.test(text)) {
        return { isPurchaseOrder: true, reason: 'Pièce jointe de type commande mentionnée' };
      }
    }

    return { isPurchaseOrder: false };
  }

  // Méthodes pour tests
  setConfidenceThreshold(threshold: number) {
    (this as any).CONFIDENCE_THRESHOLD = threshold;
  }

  getKeywordsCount(): number {
    return this.keywords.length;
  }
}
