import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InboundEmail,
  RequestContext,
  ClassifierResult,
  ClassifierDecision,
  TriggeredRule,
  RequestState,
} from '../interfaces/reminder.interfaces';
import {
  defaultChaserKeywords,
  AUTO_REPLY_HEADERS,
  INTERNAL_DOMAINS,
} from '../config/reminder.config';
import { ConversationLinkerService } from './conversation-linker.service';

/**
 * ClassifierClientChaserService
 *
 * Determines if an inbound customer email is a "chaser" (follow-up/relance)
 * using a scoring system (0-100). Score >= 60 = CHASER.
 *
 * This service is purely semantic - the decision to send an auto-reply
 * is made by CustomerAutoResponseService.
 */
@Injectable()
export class ClassifierClientChaserService {
  private readonly logger = new Logger(ClassifierClientChaserService.name);
  private readonly scoreThreshold: number;
  private readonly keywords = defaultChaserKeywords;

  constructor(
    private readonly configService: ConfigService,
    private readonly linkerService: ConversationLinkerService,
  ) {
    this.scoreThreshold = this.configService.get<number>('reminder.chaserScoreThreshold') || 60;
  }

  /**
   * Classify an inbound email as chaser or not.
   *
   * @param email - The inbound email to classify
   * @param requestContext - Optional context if already linked
   * @returns ClassifierResult with decision, score, and triggered rules
   */
  async classify(
    email: InboundEmail,
    requestContext?: RequestContext,
  ): Promise<ClassifierResult> {
    const triggeredRules: TriggeredRule[] = [];
    let score = 0;

    // ============ B) Guard Rails (hard rules) ============

    // B1. Ignore if from internal domain
    const senderEmail = this.linkerService.extractEmail(email.from);
    const senderDomain = this.linkerService.extractDomain(senderEmail);

    if (INTERNAL_DOMAINS.some(domain => senderDomain.endsWith(domain))) {
      this.logger.debug(`Blocked: internal sender ${senderEmail}`);
      return this.buildResult('BLOCKED_INTERNAL', 0, triggeredRules, 'Expéditeur interne');
    }

    // B2. Ignore if has auto-reply headers
    const autoReplyHeader = this.detectAutoReplyHeaders(email.headers);
    if (autoReplyHeader) {
      this.logger.debug(`Blocked: auto-reply header detected ${autoReplyHeader}`);
      return this.buildResult('BLOCKED_AUTO_REPLY', 0, triggeredRules, `Header auto-reply: ${autoReplyHeader}`);
    }

    // B4. Ignore if request status is closed (if context provided)
    if (requestContext) {
      const closedStatuses = this.configService.get<string[]>('reminder.closedStatuses') ||
        ['CLOSED', 'CANCELLED', 'LOST', 'WON'];
      if (closedStatuses.includes(requestContext.status)) {
        this.logger.debug(`Blocked: request status is ${requestContext.status}`);
        return this.buildResult('BLOCKED_CLOSED_STATUS', 0, triggeredRules, `Statut fermé: ${requestContext.status}`);
      }
    }

    // ============ C) Text Normalization ============

    const normalizedSubject = this.normalizeSubject(email.subject);
    const normalizedBody = this.normalizeBody(email.bodyText);

    // ============ D) Scoring ============

    // D1) Subject indicators
    const subjectStrongPoints = this.checkPatterns(
      normalizedSubject,
      [...this.keywords.subjectStrong.fr, ...this.keywords.subjectStrong.en],
      35,
      'subject_strong',
      'subject',
      triggeredRules,
    );
    score += subjectStrongPoints;

    // Subject urgent (+10, not sufficient alone)
    const subjectUrgentPoints = this.checkPatterns(
      normalizedSubject,
      this.keywords.subjectUrgent,
      10,
      'subject_urgent',
      'subject',
      triggeredRules,
    );
    score += subjectUrgentPoints;

    // D2) Body strong indicators
    const bodyStrongPoints = this.checkPatterns(
      normalizedBody,
      [...this.keywords.bodyStrong.fr, ...this.keywords.bodyStrong.en],
      35,
      'body_strong',
      'body',
      triggeredRules,
    );
    score += bodyStrongPoints;

    // Body short questions
    const bodyQuestionsPoints = this.checkPatterns(
      normalizedBody,
      [...this.keywords.bodyQuestions.fr, ...this.keywords.bodyQuestions.en],
      20,
      'body_questions',
      'body',
      triggeredRules,
    );
    score += bodyQuestionsPoints;

    // D3) Temporal indicators
    const temporalPoints = this.checkPatterns(
      normalizedBody,
      this.keywords.temporalIndicators,
      10,
      'temporal_indicators',
      'body',
      triggeredRules,
    );
    score += temporalPoints;

    // D4) Anti-false positives (negative points)

    // New request indicators -> if no context and has these, might be new request
    const newRequestPoints = this.checkPatterns(
      normalizedBody,
      [...this.keywords.newRequestIndicators.fr, ...this.keywords.newRequestIndicators.en],
      -25,
      'new_request_indicators',
      'body',
      triggeredRules,
    );

    // Only apply if no context OR context status is NEW/DRAFT
    if (!requestContext || ['NEW', 'DRAFT', 'UNLINKED'].includes(requestContext.status)) {
      score += newRequestPoints;
    }

    // Purchase order indicators (-40)
    const poPoints = this.checkPatterns(
      normalizedSubject + ' ' + normalizedBody,
      [...this.keywords.purchaseOrderIndicators.fr, ...this.keywords.purchaseOrderIndicators.en],
      -40,
      'purchase_order',
      'body',
      triggeredRules,
    );
    score += poPoints;

    // Delivery/logistics indicators (-30)
    const deliveryPoints = this.checkPatterns(
      normalizedSubject + ' ' + normalizedBody,
      [...this.keywords.deliveryIndicators.fr, ...this.keywords.deliveryIndicators.en],
      -30,
      'delivery_indicators',
      'body',
      triggeredRules,
    );
    score += deliveryPoints;

    // Cancellation indicators (-30)
    const cancelPoints = this.checkPatterns(
      normalizedSubject + ' ' + normalizedBody,
      [...this.keywords.cancellationIndicators.fr, ...this.keywords.cancellationIndicators.en],
      -30,
      'cancellation_indicators',
      'body',
      triggeredRules,
    );
    score += cancelPoints;

    // D5) Context bonuses

    // If linked via thread/reference (+15)
    if (requestContext && email.threadId) {
      score += 15;
      triggeredRules.push({
        rule: 'context_thread_linked',
        points: 15,
        location: 'context',
      });
    }

    // If linked via In-Reply-To or References (+15)
    if (requestContext && (email.inReplyTo || (email.references && email.references.length > 0))) {
      score += 15;
      triggeredRules.push({
        rule: 'context_reply_linked',
        points: 15,
        location: 'context',
      });
    }

    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, score));

    // ============ Decision ============

    let decision: ClassifierDecision;
    if (score >= this.scoreThreshold) {
      decision = 'CHASER';
    } else {
      decision = 'NOT_CHASER';
    }

    this.logger.debug(
      `Classified email "${email.subject}" from ${senderEmail}: ${decision} (score: ${score}, threshold: ${this.scoreThreshold})`,
    );

    return {
      decision,
      score,
      reasons: triggeredRules.map(r => `${r.rule}: ${r.points > 0 ? '+' : ''}${r.points}${r.match ? ` (${r.match})` : ''}`),
      triggeredRules,
    };
  }

  /**
   * Determine the request state (NEVER_TREATED, TREATED, IN_PROGRESS)
   */
  determineRequestState(requestContext?: RequestContext): RequestState {
    if (!requestContext) {
      return 'NEVER_TREATED';
    }

    // Status that indicate "never treated"
    const neverTreatedStatuses = ['DRAFT', 'NEW', 'UNLINKED'];
    if (neverTreatedStatuses.includes(requestContext.status)) {
      return 'NEVER_TREATED';
    }

    // Check if there was any outbound human activity
    if (requestContext.sentAt) {
      return 'TREATED';
    }

    // Status that indicate in progress
    const inProgressStatuses = ['PENDING', 'IN_PROGRESS', 'SENT_TO_SUPPLIER', 'AWAITING_SUPPLIER'];
    if (inProgressStatuses.includes(requestContext.status)) {
      return 'IN_PROGRESS';
    }

    return 'TREATED';
  }

  // ============ Private methods ============

  /**
   * Normalize subject for analysis
   */
  private normalizeSubject(subject: string): string {
    return this.linkerService.normalizeSubject(subject);
  }

  /**
   * Normalize body text for analysis.
   * Removes signatures, quoted replies, and cleans up text.
   */
  private normalizeBody(bodyText: string): string {
    if (!bodyText) return '';

    let text = bodyText.toLowerCase();

    // Remove quoted replies (lines starting with >)
    text = text.split('\n')
      .filter(line => !line.trim().startsWith('>'))
      .join('\n');

    // Remove "On <date>, <name> wrote:" blocks
    text = text.replace(/on\s+.{10,60}\s+wrote:[\s\S]*$/i, '');
    text = text.replace(/le\s+.{10,60}\s+a écrit[\s\S]*$/i, '');

    // Remove signature blocks
    for (const marker of this.keywords.signatureMarkers) {
      const markerIndex = text.indexOf(marker.toLowerCase());
      if (markerIndex !== -1 && markerIndex > text.length * 0.3) {
        // Only cut if marker is after 30% of the text
        text = text.substring(0, markerIndex);
      }
    }

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Check if text contains any of the patterns and return points
   */
  private checkPatterns(
    text: string,
    patterns: string[],
    points: number,
    ruleName: string,
    location: 'subject' | 'body' | 'context',
    triggeredRules: TriggeredRule[],
  ): number {
    for (const pattern of patterns) {
      if (text.includes(pattern.toLowerCase())) {
        triggeredRules.push({
          rule: ruleName,
          points,
          match: pattern,
          location,
        });
        return points; // Return on first match (don't double count)
      }
    }
    return 0;
  }

  /**
   * Detect auto-reply headers
   */
  private detectAutoReplyHeaders(headers: Record<string, string>): string | null {
    for (const config of AUTO_REPLY_HEADERS) {
      const headerValue = headers[config.header] || headers[config.header.toLowerCase()];
      if (!headerValue) continue;

      if ('value' in config && headerValue === config.value) {
        return config.header;
      }

      if ('values' in config && config.values && config.values.some(v => headerValue.toLowerCase().includes(v))) {
        return config.header;
      }
    }
    return null;
  }

  /**
   * Build a classifier result
   */
  private buildResult(
    decision: ClassifierDecision,
    score: number,
    triggeredRules: TriggeredRule[],
    reason?: string,
  ): ClassifierResult {
    const reasons = [...triggeredRules.map(r => `${r.rule}: ${r.points}`)];
    if (reason) {
      reasons.unshift(reason);
    }

    return {
      decision,
      score,
      reasons,
      triggeredRules,
    };
  }
}
