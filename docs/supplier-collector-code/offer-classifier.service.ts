import { Injectable, Logger } from '@nestjs/common';
import {
  MessageClassification,
  ClassificationResult,
  ScoringRule,
  SyncedEmail,
  SyncedAttachment,
} from '../interfaces/supplier-collector.interfaces';

/**
 * OfferClassifierService
 *
 * Classifie les emails pour identifier ceux où un fournisseur
 * a fait une offre commerciale (devis, cotation, etc.)
 */
@Injectable()
export class OfferClassifierService {
  private readonly logger = new Logger(OfferClassifierService.name);

  // ============ SCORING RULES ============

  // Pièces jointes positives
  private readonly attachmentRules: ScoringRule[] = [
    { pattern: /\.pdf$/i, score: 3, reason: 'HAS_PDF' },
    { pattern: /\.xlsx?$/i, score: 3, reason: 'HAS_EXCEL' },
    { pattern: /\.csv$/i, score: 2, reason: 'HAS_CSV' },
  ];

  // Mots-clés positifs (FR + EN)
  private readonly positiveKeywords: ScoringRule[] = [
    // Devis / Cotation
    { pattern: /\b(devis|quotation|quote)\b/i, score: 2, reason: 'KEYWORDS_QUOTE' },
    { pattern: /\bcotation\b/i, score: 2, reason: 'KEYWORDS_QUOTE' },
    // Prix
    { pattern: /\b(prix|price|prices|pricing|tarif)\b/i, score: 1, reason: 'KEYWORDS_PRICE' },
    // Offre
    { pattern: /\b(offre|offer|proposal)\b/i, score: 1, reason: 'KEYWORDS_OFFER' },
    { pattern: /\boffre (de prix|commerciale)\b/i, score: 2, reason: 'KEYWORDS_OFFER' },
    // Proforma
    { pattern: /\bpro[-\s]?forma\b/i, score: 2, reason: 'KEYWORDS_PROFORMA' },
    // Pièces jointes
    { pattern: /\b(please find attached|ci-joint|en pièce jointe|herewith|attached|en annexe)\b/i, score: 1, reason: 'KEYWORDS_ATTACHED' },
    // Validité
    { pattern: /\b(validit[ée]|valid until|valable jusqu)\b/i, score: 1, reason: 'KEYWORDS_VALIDITY' },
    // Délai de livraison
    { pattern: /\b(d[ée]lai|lead time|delivery time|livraison)\b/i, score: 1, reason: 'KEYWORDS_DELIVERY' },
  ];

  // Mots-clés négatifs (déclin)
  private readonly declineKeywords: ScoringRule[] = [
    { pattern: /\b(regret|regrettons)\b/i, score: -4, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(decline|declined|d[ée]clin[ée])\b/i, score: -4, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(cannot quote|can't quote|unable to quote)\b/i, score: -4, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(no bid|pas en mesure)\b/i, score: -4, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(not in our scope|hors (de notre )?gamme)\b/i, score: -3, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(we do not supply|nous ne fournissons pas)\b/i, score: -3, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(unfortunately|malheureusement)\b/i, score: -2, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(unable to|not available|indisponible)\b/i, score: -2, reason: 'KEYWORDS_DECLINE' },
    { pattern: /\b(not interested|pas int[ée]ress[ée])\b/i, score: -3, reason: 'KEYWORDS_DECLINE' },
  ];

  // Mots-clés pending (accusé de réception sans offre)
  private readonly pendingKeywords: ScoringRule[] = [
    { pattern: /\b(received|bien re[çc]u|accus[ée] de r[ée]ception)\b/i, score: -2, reason: 'KEYWORDS_PENDING' },
    { pattern: /\b(noted|pris note)\b/i, score: -1, reason: 'KEYWORDS_PENDING' },
    { pattern: /\b(we will (check|revert|review)|on revient vers vous)\b/i, score: -2, reason: 'KEYWORDS_PENDING' },
    { pattern: /\b(under review|en cours d'[ée]tude)\b/i, score: -2, reason: 'KEYWORDS_PENDING' },
    { pattern: /\b(will get back|reviendrons vers)\b/i, score: -2, reason: 'KEYWORDS_PENDING' },
  ];

  // Patterns de prix
  private readonly pricingPatterns: ScoringRule[] = [
    { pattern: /\b\d+[.,]\d{2}\s*(€|EUR|USD|\$|XOF|CFA)\b/i, score: 2, reason: 'PRICING_PATTERN' },
    { pattern: /\b(€|EUR|USD|\$)\s*\d+[.,]\d{2}\b/i, score: 2, reason: 'PRICING_PATTERN' },
    { pattern: /\bunit\s*price\s*[:=]?\s*\d/i, score: 2, reason: 'PRICING_PATTERN' },
    { pattern: /\bprix\s*unitaire\s*[:=]?\s*\d/i, score: 2, reason: 'PRICING_PATTERN' },
    { pattern: /\btotal\s*[:=]?\s*\d+[.,]\d{2}/i, score: 1, reason: 'PRICING_PATTERN' },
  ];

  // ============ PUBLIC METHODS ============

  /**
   * Classifie un email
   */
  classify(email: SyncedEmail): ClassificationResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. Scorer les pièces jointes
    const attachmentScore = this.scoreAttachments(email.attachments);
    score += attachmentScore.score;
    reasons.push(...attachmentScore.reasons);

    // 2. Scorer le sujet
    const subjectScore = this.scoreText(email.subject, [
      ...this.positiveKeywords,
      ...this.declineKeywords,
      ...this.pendingKeywords,
    ]);
    score += subjectScore.score;
    reasons.push(...subjectScore.reasons);

    // 3. Scorer le corps
    if (email.bodyText) {
      const bodyScore = this.scoreText(email.bodyText, [
        ...this.positiveKeywords,
        ...this.declineKeywords,
        ...this.pendingKeywords,
        ...this.pricingPatterns,
      ]);
      score += bodyScore.score;
      reasons.push(...bodyScore.reasons);
    }

    // 4. Déterminer la classification
    const classification = this.determineClassification(score, reasons);

    return {
      classification,
      score,
      reasons: [...new Set(reasons)], // Dédupliquer
    };
  }

  /**
   * Vérifie si un email est une offre potentielle (pour pré-filtrage)
   */
  isPotentialOffer(email: SyncedEmail): boolean {
    // Quick check: a-t-il des pièces jointes pertinentes?
    const hasRelevantAttachment = email.attachments.some(
      att => !att.isInline && /\.(pdf|xlsx?|csv)$/i.test(att.filename)
    );

    // Quick check: mots-clés dans le sujet?
    const hasQuoteKeyword = /\b(devis|quote|quotation|offre|cotation|proforma|prix|price)\b/i.test(email.subject);

    return hasRelevantAttachment || hasQuoteKeyword;
  }

  // ============ PRIVATE METHODS ============

  private scoreAttachments(attachments: SyncedAttachment[]): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    for (const att of attachments) {
      // Ignorer les images inline (signatures, logos)
      if (att.isInline && att.mimeType.startsWith('image/')) {
        continue;
      }

      for (const rule of this.attachmentRules) {
        if (rule.pattern.test(att.filename)) {
          score += rule.score;
          if (!reasons.includes(rule.reason)) {
            reasons.push(rule.reason);
          }
          break; // Une seule règle par pièce jointe
        }
      }
    }

    return { score, reasons };
  }

  private scoreText(text: string, rules: ScoringRule[]): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        score += rule.score;
        if (!reasons.includes(rule.reason)) {
          reasons.push(rule.reason);
        }
      }
    }

    return { score, reasons };
  }

  private determineClassification(score: number, reasons: string[]): MessageClassification {
    const hasDecline = reasons.includes('KEYWORDS_DECLINE');
    const hasPending = reasons.includes('KEYWORDS_PENDING');

    // Déclin explicite
    if (hasDecline || score <= -3) {
      return MessageClassification.DECLINED;
    }

    // Offre détectée (score >= 3)
    if (score >= 3) {
      return MessageClassification.OFFER;
    }

    // En attente (accusé de réception)
    if (hasPending && score < 3) {
      return MessageClassification.PENDING;
    }

    // Pas d'offre
    return MessageClassification.NO_OFFER;
  }
}
