import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
export class DetectorService implements OnModuleInit {
  private readonly logger = new Logger(DetectorService.name);
  private keywords: DetectionKeyword[] = [];
  private readonly CONFIDENCE_THRESHOLD = 40; // Seuil minimum pour considérer comme demande de prix
  private readonly SCORE_FOR_100_PERCENT = 30; // Score nécessaire pour atteindre 100% de confiance

  constructor(private readonly databaseService: DatabaseService) {
    // Keywords loaded in onModuleInit after database is ready
  }

  async onModuleInit() {
    await this.loadKeywords();
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

    // ═══════════════════════════════════════════════════════════════════════
    // FAST-PATH: Patterns explicites de demandes de prix (détection immédiate)
    // ═══════════════════════════════════════════════════════════════════════
    const explicitRfqCheck = this.checkExplicitRfqPatterns(subjectLower, bodyLower);
    if (explicitRfqCheck.isExplicitRfq) {
      // Vérifier les pièces jointes
      const relevantExtensions = ['.pdf', '.xlsx', '.xls', '.docx', '.doc'];
      const attachmentTypes = email.attachments
        .map(att => att.filename.substring(att.filename.lastIndexOf('.')).toLowerCase())
        .filter(ext => relevantExtensions.includes(ext));

      return {
        isPriceRequest: true,
        confidence: 95,
        matchedKeywords: [{ keyword: explicitRfqCheck.pattern!, location: 'subject', weight: 10 }],
        hasRelevantAttachments: attachmentTypes.length > 0,
        attachmentTypes,
        reason: `Demande de prix explicite détectée: ${explicitRfqCheck.pattern}`,
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

    // Calculer la confiance (0-100) avec un seuil fixe
    // Ainsi, le score ne dépend pas du nombre de mots-clés dans la base
    // Exemples de scores typiques:
    // - "RFQ" dans le corps = 10 points → 33%
    // - "RFQ" dans le sujet = 15 points → 50%
    // - "demande de prix" + "devis" dans le corps = 18 points → 60%
    // - "RFQ" sujet + "quotation" corps + pièce jointe = 15 + 8 + 10 = 33 points → 100%
    const confidence = Math.min(100, Math.round((totalScore / this.SCORE_FOR_100_PERCENT) * 100));

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
   * Vérifie si l'email contient des patterns explicites de demande de prix
   * (détection rapide sans calcul de score)
   */
  private checkExplicitRfqPatterns(subject: string, body: string): { isExplicitRfq: boolean; pattern?: string } {
    // Patterns explicites dans le sujet qui indiquent clairement une RFQ
    const explicitPatterns = [
      // "RFQ" seul dans le sujet - terme très spécifique aux demandes de prix
      { pattern: /\brfq\b/i, label: 'RFQ' },

      // "RFQ FOR ..." - Pattern très courant
      { pattern: /\brfq\s+for\b/i, label: 'RFQ FOR' },
      { pattern: /\brfq\s+pr[-\s]?\d+/i, label: 'RFQ PR-xxx' },
      { pattern: /\brfq\s+#?\d+/i, label: 'RFQ #xxx' },

      // "Request for Quotation" explicite
      { pattern: /\brequest\s+for\s+quotation\b/i, label: 'Request for Quotation' },
      { pattern: /\brequest\s+for\s+quote\b/i, label: 'Request for Quote' },

      // Français explicite
      { pattern: /\bdemande\s+de\s+prix\b/i, label: 'Demande de prix' },
      { pattern: /\bdemande\s+de\s+cotation\b/i, label: 'Demande de cotation' },
      { pattern: /\bdemande\s+de\s+devis\b/i, label: 'Demande de devis' },
      { pattern: /\bappel\s+d['']?offres?\b/i, label: 'Appel d\'offres' },

      // Patterns avec numéro de référence
      { pattern: /\brfq\s*[-:]\s*[a-z0-9]{3,}/i, label: 'RFQ-xxx' },
      { pattern: /\bquotation\s+request\s+(?:for|#|n[°o])/i, label: 'Quotation Request' },
      { pattern: /\bprice\s+request\s+(?:for|#|n[°o])/i, label: 'Price Request' },
    ];

    // Vérifier d'abord le sujet (plus fiable)
    for (const { pattern, label } of explicitPatterns) {
      if (pattern.test(subject)) {
        return { isExplicitRfq: true, pattern: label };
      }
    }

    // Vérifier le corps pour les patterns les plus explicites
    const bodyPatterns = [
      { pattern: /\bplease\s+(?:quote|provide\s+(?:your\s+)?(?:best\s+)?(?:price|quotation))\b/i, label: 'Please quote' },
      { pattern: /\bkindly\s+(?:quote|send\s+(?:your\s+)?(?:best\s+)?(?:price|quotation))\b/i, label: 'Kindly quote' },
      { pattern: /\bmerci\s+de\s+(?:nous\s+)?(?:coter|chiffrer|transmettre\s+(?:votre\s+)?(?:meilleur[es]?\s+)?prix)\b/i, label: 'Merci de coter' },
      { pattern: /\bprière\s+de\s+(?:nous\s+)?faire\s+parvenir\s+(?:votre\s+)?(?:meilleur[es]?\s+)?(?:offre|prix)\b/i, label: 'Prière de faire parvenir' },
    ];

    for (const { pattern, label } of bodyPatterns) {
      if (pattern.test(body)) {
        return { isExplicitRfq: true, pattern: label };
      }
    }

    return { isExplicitRfq: false };
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
