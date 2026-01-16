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
 *
 * AMÉLIORATIONS v2:
 * - Seuil OFFER augmenté à 5 (meilleure précision)
 * - Nettoyage du body avant scoring
 * - Règles de scoring plus complètes
 * - Calcul de confiance
 */
@Injectable()
export class OfferClassifierService {
  private readonly logger = new Logger(OfferClassifierService.name);

  // ============ SEUILS ============
  private readonly OFFER_THRESHOLD = 5;  // CORRECTION: augmenté de 3 à 5
  private readonly DECLINE_THRESHOLD = -3;

  // ============ RÈGLES POSITIVES FORTES ============
  private readonly positiveKeywordsStrong: ScoringRule[] = [
    { pattern: /\b(devis|quotation)\b/i, score: 3, reason: 'TERM_QUOTATION' },
    { pattern: /\bcotation\b/i, score: 3, reason: 'TERM_QUOTATION' },
    { pattern: /\bpro[-\s]?forma\b/i, score: 3, reason: 'TERM_PROFORMA' },
    { pattern: /\boffre\s+(de\s+prix|commerciale|tarifaire)\b/i, score: 3, reason: 'TERM_COMMERCIAL_OFFER' },
    { pattern: /\b(price\s+)?quotation\b/i, score: 3, reason: 'TERM_QUOTATION' },
    { pattern: /\bour\s+(best\s+)?offer\b/i, score: 3, reason: 'TERM_OUR_OFFER' },
    { pattern: /\bnotre\s+offre\b/i, score: 3, reason: 'TERM_OUR_OFFER' },
  ];

  // ============ RÈGLES POSITIVES MOYENNES ============
  private readonly positiveKeywordsMedium: ScoringRule[] = [
    { pattern: /\b(prix|price|tarif|pricing)\s*(unitaire|unit|total)?\b/i, score: 2, reason: 'TERM_PRICE' },
    { pattern: /\bunit\s*price\b/i, score: 2, reason: 'TERM_UNIT_PRICE' },
    { pattern: /\bprix\s*unitaire\b/i, score: 2, reason: 'TERM_UNIT_PRICE' },
    { pattern: /\b(ci-joint|please\s+find\s+attached|en\s+pi[eè]ce\s+jointe|herewith)\b.*\b(devis|offre|quotation|price)/i, score: 2, reason: 'ATTACHED_QUOTE' },
    { pattern: /\b(devis|offre|quotation|price).*\b(ci-joint|attached|en\s+annexe)\b/i, score: 2, reason: 'ATTACHED_QUOTE' },
    { pattern: /\b(validit[ée]|valid\s+until|valable\s+jusqu|offer\s+valid)\b/i, score: 2, reason: 'TERM_VALIDITY' },
    { pattern: /\b(d[ée]lai|lead\s+time|delivery\s+time)\s*[:=]?\s*\d+/i, score: 2, reason: 'TERM_DELIVERY_TIME' },
  ];

  // ============ RÈGLES POSITIVES FAIBLES ============
  private readonly positiveKeywordsWeak: ScoringRule[] = [
    { pattern: /\b(offre|offer|proposal)\b/i, score: 1, reason: 'TERM_OFFER_GENERIC' },
    { pattern: /\b(prix|price|prices)\b/i, score: 1, reason: 'TERM_PRICE_GENERIC' },
    { pattern: /\bqt[ey]?\s*[:=]?\s*\d+/i, score: 1, reason: 'TERM_QUANTITY' },
    { pattern: /\b(minimum\s+order|moq)\b/i, score: 1, reason: 'TERM_MOQ' },
    { pattern: /\b(ci-joint|attached|en\s+annexe|herewith)\b/i, score: 1, reason: 'TERM_ATTACHED' },
  ];

  // ============ PATTERNS DE PRIX ============
  private readonly pricingPatterns: ScoringRule[] = [
    { pattern: /\b\d{1,3}([.,]\d{3})*[.,]\d{2}\s*(€|EUR|USD|\$|XOF|CFA|GBP|£)\b/i, score: 2, reason: 'PRICE_AMOUNT' },
    { pattern: /\b(€|EUR|USD|\$|XOF|CFA|GBP|£)\s*\d{1,3}([.,]\d{3})*[.,]?\d{0,2}\b/i, score: 2, reason: 'PRICE_AMOUNT' },
    { pattern: /\b(PU|P\.U\.|unit\s*price|prix\s*unit)\s*[:=]?\s*[\d.,]+/i, score: 2, reason: 'PRICE_UNIT_STRUCTURED' },
    { pattern: /\b(total|montant|amount)\s*[:=]?\s*[\d.,]+\s*(€|EUR|USD|\$|XOF|CFA)?/i, score: 1, reason: 'PRICE_TOTAL' },
  ];

  // ============ PIÈCES JOINTES ============
  private readonly attachmentPatterns: ScoringRule[] = [
    { pattern: /\b(devis|quotation|quote|offre|proforma)\b.*\.(pdf|xlsx?)$/i, score: 3, reason: 'ATTACHMENT_QUOTE_NAME' },
    { pattern: /\b(price|prix|tarif|pricing)\b.*\.(pdf|xlsx?)$/i, score: 2, reason: 'ATTACHMENT_PRICE_NAME' },
    { pattern: /\.pdf$/i, score: 1, reason: 'HAS_PDF' },
    { pattern: /\.xlsx?$/i, score: 1, reason: 'HAS_EXCEL' },
    { pattern: /\.csv$/i, score: 1, reason: 'HAS_CSV' },
  ];

  // ============ RÈGLES NÉGATIVES (DÉCLIN) ============
  private readonly declineKeywords: ScoringRule[] = [
    { pattern: /\b(we\s+regret|nous\s+regrettons)\b/i, score: -5, reason: 'DECLINE_REGRET' },
    { pattern: /\b(cannot\s+quote|can't\s+quote|unable\s+to\s+quote)\b/i, score: -5, reason: 'DECLINE_CANNOT_QUOTE' },
    { pattern: /\b(no\s+bid|pas\s+en\s+mesure)\b/i, score: -5, reason: 'DECLINE_NO_BID' },
    { pattern: /\b(decline[ds]?|déclin[ée]?s?)\b/i, score: -4, reason: 'DECLINE_EXPLICIT' },
    { pattern: /\b(not\s+in\s+our\s+scope|hors\s+(de\s+notre\s+)?gamme)\b/i, score: -4, reason: 'DECLINE_OUT_OF_SCOPE' },
    { pattern: /\b(we\s+do\s+not\s+supply|nous\s+ne\s+fournissons\s+pas)\b/i, score: -4, reason: 'DECLINE_NOT_SUPPLIER' },
    { pattern: /\b(not\s+available|indisponible|discontinued)\b/i, score: -3, reason: 'DECLINE_NOT_AVAILABLE' },
    { pattern: /\b(unfortunately|malheureusement)\b/i, score: -2, reason: 'DECLINE_UNFORTUNATELY' },
    { pattern: /\b(not\s+interested|pas\s+int[ée]ress[ée]?s?)\b/i, score: -4, reason: 'DECLINE_NOT_INTERESTED' },
    { pattern: /\b(we\s+are\s+not\s+able|nous\s+ne\s+sommes\s+pas\s+en\s+mesure)\b/i, score: -3, reason: 'DECLINE_NOT_ABLE' },
  ];

  // ============ RÈGLES PENDING (ACCUSÉ DE RÉCEPTION) ============
  private readonly pendingKeywords: ScoringRule[] = [
    { pattern: /\b(well?\s+received|bien\s+re[çc]u|accus[ée]\s+de\s+r[ée]ception)\b/i, score: -2, reason: 'PENDING_RECEIVED' },
    { pattern: /\b(duly\s+noted|noted|pris\s+note)\b/i, score: -1, reason: 'PENDING_NOTED' },
    { pattern: /\b(we\s+will\s+(check|review|revert)|on\s+revient\s+vers\s+vous)\b/i, score: -2, reason: 'PENDING_WILL_REVIEW' },
    { pattern: /\b(under\s+review|en\s+cours\s+d'[ée]tude|being\s+processed)\b/i, score: -2, reason: 'PENDING_UNDER_REVIEW' },
    { pattern: /\b(will\s+get\s+back|reviendrons\s+vers)\b/i, score: -2, reason: 'PENDING_WILL_RESPOND' },
    { pattern: /\b(dans\s+les\s+meilleurs\s+d[ée]lais|as\s+soon\s+as\s+possible)\b/i, score: -1, reason: 'PENDING_ASAP' },
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

    // 2. Scorer le sujet (poids x1.5 car plus fiable)
    const subjectScore = this.scoreText(email.subject, 1.5);
    score += subjectScore.score;
    reasons.push(...subjectScore.reasons);

    // 3. Scorer le corps (nettoyer d'abord pour éviter faux positifs)
    if (email.bodyText) {
      const cleanBody = this.cleanBody(email.bodyText);
      const bodyScore = this.scoreText(cleanBody, 1.0);
      score += bodyScore.score;
      reasons.push(...bodyScore.reasons);
    }

    // 4. Bonus combinatoire (pièce jointe + mots-clés = très probable offre)
    if (this.hasRelevantAttachment(email.attachments) && this.hasQuoteKeywords(reasons)) {
      score += 2;
      reasons.push('COMBO_ATTACHMENT_KEYWORDS');
    }

    // 5. Déterminer la classification
    const classification = this.determineClassification(score, reasons);
    const confidence = this.calculateConfidence(score, reasons);

    this.logger.debug(
      `Classified "${email.subject.substring(0, 50)}..." as ${classification} (score=${score}, conf=${confidence.toFixed(2)})`
    );

    return {
      classification,
      score,
      reasons: [...new Set(reasons)], // Dédupliquer
      confidence,
    };
  }

  /**
   * Vérifie si un email est une offre potentielle (pour pré-filtrage rapide)
   */
  isPotentialOffer(email: SyncedEmail): boolean {
    const hasRelevantAttachment = this.hasRelevantAttachment(email.attachments);
    const hasQuoteKeyword = /\b(devis|quote|quotation|offre|cotation|proforma|prix|price)\b/i.test(email.subject);

    return hasRelevantAttachment || hasQuoteKeyword;
  }

  // ============ PRIVATE METHODS ============

  private scoreAttachments(attachments: SyncedAttachment[]): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    for (const att of attachments) {
      // Ignorer les images inline (signatures, logos)
      if (att.isInline && att.mimeType?.startsWith('image/')) {
        continue;
      }

      for (const rule of this.attachmentPatterns) {
        if (rule.pattern.test(att.filename)) {
          score += rule.score;
          if (!reasons.includes(rule.reason)) {
            reasons.push(rule.reason);
          }
        }
      }
    }

    return { score, reasons };
  }

  private scoreText(text: string, multiplier: number = 1.0): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const allRules = [
      ...this.positiveKeywordsStrong,
      ...this.positiveKeywordsMedium,
      ...this.positiveKeywordsWeak,
      ...this.pricingPatterns,
      ...this.declineKeywords,
      ...this.pendingKeywords,
    ];

    for (const rule of allRules) {
      if (rule.pattern.test(text)) {
        score += Math.round(rule.score * multiplier);
        if (!reasons.includes(rule.reason)) {
          reasons.push(rule.reason);
        }
      }
    }

    return { score, reasons };
  }

  /**
   * Nettoie le body pour éviter les faux positifs dans signatures/disclaimers
   */
  private cleanBody(text: string): string {
    let cleaned = text;

    // Limiter aux premiers 8000 caractères
    if (cleaned.length > 8000) {
      cleaned = cleaned.substring(0, 8000);
    }

    // Supprimer signatures
    const signatureSeparators = [
      /\n[-_]{3,}\s*\n/,
      /\n--\s*\n/,
      /\nCordialement[\s\S]*$/i,
      /\nBest regards[\s\S]*$/i,
      /\nKind regards[\s\S]*$/i,
      /\nSincerely[\s\S]*$/i,
      /\nRegards[\s\S]*$/i,
      /\nSent from my[\s\S]*$/i,
      /\nEnvoyé depuis[\s\S]*$/i,
      /\nGet Outlook[\s\S]*$/i,
    ];

    for (const sep of signatureSeparators) {
      const match = cleaned.match(sep);
      if (match && match.index !== undefined && match.index > 200) {
        cleaned = cleaned.substring(0, match.index);
      }
    }

    // Supprimer disclaimers
    cleaned = cleaned.replace(/This email.*privileged.*$/is, '');
    cleaned = cleaned.replace(/Confidential.*intended only.*$/is, '');
    cleaned = cleaned.replace(/Ce message.*confidentiel.*$/is, '');
    cleaned = cleaned.replace(/AVIS DE CONFIDENTIALITÉ[\s\S]*$/i, '');
    cleaned = cleaned.replace(/CONFIDENTIALITY NOTICE[\s\S]*$/i, '');

    // Supprimer citations
    cleaned = cleaned.replace(/^>.*$/gm, '');
    cleaned = cleaned.replace(/^Le \d.*a écrit\s*:[\s\S]*$/im, '');
    cleaned = cleaned.replace(/^On \d.*wrote\s*:[\s\S]*$/im, '');
    cleaned = cleaned.replace(/^From:.*\nSent:.*\nTo:.*\nSubject:.*$/gm, '');

    return cleaned.trim();
  }

  private hasRelevantAttachment(attachments: SyncedAttachment[]): boolean {
    return attachments.some(att =>
      !att.isInline &&
      /\.(pdf|xlsx?|csv)$/i.test(att.filename)
    );
  }

  private hasQuoteKeywords(reasons: string[]): boolean {
    const quoteReasons = [
      'TERM_QUOTATION', 'TERM_PROFORMA', 'TERM_COMMERCIAL_OFFER',
      'TERM_OUR_OFFER', 'TERM_PRICE', 'TERM_UNIT_PRICE', 'PRICE_AMOUNT',
      'ATTACHMENT_QUOTE_NAME',
    ];
    return reasons.some(r => quoteReasons.includes(r));
  }

  private determineClassification(score: number, reasons: string[]): MessageClassification {
    const hasDecline = reasons.some(r => r.startsWith('DECLINE_'));
    const hasPending = reasons.some(r => r.startsWith('PENDING_'));
    const hasOffer = reasons.some(r =>
      r.startsWith('TERM_') ||
      r.startsWith('PRICE_') ||
      r === 'COMBO_ATTACHMENT_KEYWORDS' ||
      r === 'ATTACHMENT_QUOTE_NAME'
    );

    // Déclin explicite
    if (hasDecline && score <= this.DECLINE_THRESHOLD) {
      return MessageClassification.DECLINED;
    }

    // Offre détectée (score >= 5 ET présence de mots-clés offre)
    if (score >= this.OFFER_THRESHOLD && hasOffer) {
      return MessageClassification.OFFER;
    }

    // En attente (accusé de réception sans offre)
    if (hasPending && !hasOffer) {
      return MessageClassification.PENDING;
    }

    // Zone grise: score entre seuils
    if (score > this.DECLINE_THRESHOLD && score < this.OFFER_THRESHOLD) {
      if (hasOffer && score >= 3) {
        return MessageClassification.PENDING;
      }
      return MessageClassification.NO_OFFER;
    }

    return MessageClassification.NO_OFFER;
  }

  /**
   * Calcule un score de confiance pour la classification
   */
  private calculateConfidence(score: number, reasons: string[]): number {
    let confidence: number;

    if (score >= this.OFFER_THRESHOLD) {
      confidence = Math.min(0.95, 0.7 + (score - this.OFFER_THRESHOLD) * 0.05);
    } else if (score <= this.DECLINE_THRESHOLD) {
      confidence = Math.min(0.9, 0.6 + Math.abs(score) * 0.05);
    } else {
      confidence = 0.4 + Math.abs(score) * 0.05;
    }

    // Bonus pour combinaison pièce jointe + mots-clés
    if (reasons.includes('COMBO_ATTACHMENT_KEYWORDS')) {
      confidence = Math.min(0.95, confidence + 0.1);
    }

    // Pénalité si signaux mixtes (positif et négatif)
    const hasPositive = reasons.some(r => r.startsWith('TERM_') || r.startsWith('PRICE_'));
    const hasNegative = reasons.some(r => r.startsWith('DECLINE_') || r.startsWith('PENDING_'));
    if (hasPositive && hasNegative) {
      confidence *= 0.8;
    }

    return Math.max(0.1, Math.min(0.95, confidence));
  }
}
