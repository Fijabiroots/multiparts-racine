import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InboundEmail,
  LinkResult,
  RequestContext,
  SentDateResult,
  RequestStatus,
} from '../interfaces/reminder.interfaces';
import { RFQ_TOKEN_PATTERNS } from '../config/reminder.config';
import { DatabaseService } from '../../database/database.service';

/**
 * ConversationLinkerService
 *
 * Handles correlation between inbound emails and existing requests/RFQs.
 * Also resolves sent dates from procurement@ Sent folder.
 */
@Injectable()
export class ConversationLinkerService {
  private readonly logger = new Logger(ConversationLinkerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Match an inbound customer email to an existing request/RFQ.
   *
   * Priority order:
   * 1. Thread ID match
   * 2. In-Reply-To header match
   * 3. References header match
   * 4. RFQ token in subject/body
   * 5. Subject normalization heuristic + customer domain + date window
   */
  async matchInboundCustomerEmailToRequest(
    email: InboundEmail,
  ): Promise<LinkResult> {
    const senderEmail = this.extractEmail(email.from);
    const senderDomain = this.extractDomain(senderEmail);

    // 1. Thread ID match
    if (email.threadId) {
      const context = await this.findByThreadId(email.threadId);
      if (context) {
        this.logger.debug(`Matched by threadId: ${email.threadId} -> ${context.internalRfqNumber}`);
        return {
          linked: true,
          requestContext: context,
          matchMethod: 'thread_id',
          confidence: 100,
        };
      }
    }

    // 2. In-Reply-To match
    if (email.inReplyTo) {
      const context = await this.findByMessageId(email.inReplyTo);
      if (context) {
        this.logger.debug(`Matched by In-Reply-To: ${email.inReplyTo} -> ${context.internalRfqNumber}`);
        return {
          linked: true,
          requestContext: context,
          matchMethod: 'in_reply_to',
          confidence: 95,
        };
      }
    }

    // 3. References header match
    if (email.references && email.references.length > 0) {
      for (const ref of email.references) {
        const context = await this.findByMessageId(ref);
        if (context) {
          this.logger.debug(`Matched by References: ${ref} -> ${context.internalRfqNumber}`);
          return {
            linked: true,
            requestContext: context,
            matchMethod: 'references',
            confidence: 90,
          };
        }
      }
    }

    // 4. RFQ token in subject or body
    const tokens = this.extractRfqTokens(email.subject + ' ' + email.bodyText);
    for (const token of tokens) {
      const context = await this.findByRfqToken(token, senderDomain);
      if (context) {
        this.logger.debug(`Matched by RFQ token: ${token} -> ${context.internalRfqNumber}`);
        return {
          linked: true,
          requestContext: context,
          matchMethod: 'rfq_token',
          confidence: 85,
        };
      }
    }

    // 5. Subject heuristic + customer domain + date window (last 30 days)
    const normalizedSubject = this.normalizeSubject(email.subject);
    const heuristicContext = await this.findBySubjectHeuristic(
      normalizedSubject,
      senderEmail,
      senderDomain,
      email.date,
    );
    if (heuristicContext) {
      this.logger.debug(`Matched by subject heuristic: ${normalizedSubject} -> ${heuristicContext.internalRfqNumber}`);
      return {
        linked: true,
        requestContext: heuristicContext,
        matchMethod: 'subject_heuristic',
        confidence: 70,
      };
    }

    // No match found
    this.logger.debug(`No match found for email from ${senderEmail}: ${email.subject}`);
    return {
      linked: false,
      confidence: 0,
    };
  }

  /**
   * Resolve the sent date for an RFQ from procurement@ Sent folder.
   *
   * @param rfqToken - The RFQ token (e.g., DDP-20260114-001) or internal RFQ number
   * @param sentEmails - Array of emails from the Sent folder to search in
   */
  async resolveSentDateForRfq(
    rfqToken: string,
    sentEmails: Array<{ messageId: string; subject: string; body: string; date: Date; threadId?: string }>,
  ): Promise<SentDateResult> {
    // First try to find by RFQ mapping in database (if we stored the sent message ID)
    const mapping = await this.databaseService.getRfqMappingByInternalRfq(rfqToken);

    if (mapping?.messageId) {
      // Check if this message ID is in the sent emails
      const sentEmail = sentEmails.find(e => e.messageId === mapping.messageId);
      if (sentEmail) {
        return {
          found: true,
          sentAt: sentEmail.date,
          messageId: sentEmail.messageId,
          threadId: sentEmail.threadId,
          matchMethod: 'message_id',
        };
      }
    }

    // Search by RFQ token in subject
    for (const sentEmail of sentEmails) {
      const subjectTokens = this.extractRfqTokens(sentEmail.subject);
      if (subjectTokens.includes(rfqToken.toUpperCase()) || subjectTokens.includes(rfqToken)) {
        return {
          found: true,
          sentAt: sentEmail.date,
          messageId: sentEmail.messageId,
          threadId: sentEmail.threadId,
          matchMethod: 'rfq_token_subject',
        };
      }
    }

    // Search by RFQ token in body
    for (const sentEmail of sentEmails) {
      const bodyTokens = this.extractRfqTokens(sentEmail.body);
      if (bodyTokens.includes(rfqToken.toUpperCase()) || bodyTokens.includes(rfqToken)) {
        return {
          found: true,
          sentAt: sentEmail.date,
          messageId: sentEmail.messageId,
          threadId: sentEmail.threadId,
          matchMethod: 'rfq_token_body',
        };
      }
    }

    // Not found
    return {
      found: false,
    };
  }

  /**
   * Normalize email subject for comparison.
   * Removes RE:, FW:, FWD:, TR:, etc. prefixes and normalizes whitespace.
   */
  normalizeSubject(subject: string): string {
    if (!subject) return '';

    let normalized = subject.toLowerCase();

    // Remove common reply/forward prefixes
    const prefixes = [
      /^re:\s*/i,
      /^fw:\s*/i,
      /^fwd:\s*/i,
      /^tr:\s*/i,
      /^réf:\s*/i,
      /^ref:\s*/i,
      /^aw:\s*/i, // German
      /^sv:\s*/i, // Scandinavian
      /^vs:\s*/i, // Dutch
    ];

    // Apply repeatedly until no more prefixes
    let previousLength: number;
    do {
      previousLength = normalized.length;
      for (const prefix of prefixes) {
        normalized = normalized.replace(prefix, '');
      }
    } while (normalized.length < previousLength);

    // Collapse whitespace and trim
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Remove leading/trailing punctuation
    normalized = normalized.replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '');

    return normalized;
  }

  /**
   * Extract RFQ tokens from text (subject or body)
   */
  extractRfqTokens(text: string): string[] {
    if (!text) return [];

    const tokens: string[] = [];
    for (const pattern of RFQ_TOKEN_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        tokens.push(match[0].toUpperCase());
      }
    }

    return [...new Set(tokens)]; // Deduplicate
  }

  /**
   * Extract email address from a "Name <email@domain.com>" format
   */
  extractEmail(fromField: string): string {
    if (!fromField) return '';

    const match = fromField.match(/<([^>]+)>/);
    if (match) {
      return match[1].toLowerCase();
    }
    return fromField.toLowerCase().trim();
  }

  /**
   * Extract domain from email address
   */
  extractDomain(email: string): string {
    const parts = email.split('@');
    return parts.length > 1 ? parts[1].toLowerCase() : '';
  }

  // ============ Private methods ============

  private async findByThreadId(threadId: string): Promise<RequestContext | null> {
    // This would need a thread_id column in rfq_mappings or a separate threads table
    // For now, return null - implement when thread tracking is added
    return null;
  }

  private async findByMessageId(messageId: string): Promise<RequestContext | null> {
    const mapping = await this.databaseService.getRfqMappingByMessageId(messageId);
    if (!mapping) return null;

    return this.buildRequestContext(mapping);
  }

  private async findByRfqToken(
    token: string,
    senderDomain?: string,
  ): Promise<RequestContext | null> {
    // Try internal RFQ number
    let mapping = await this.databaseService.getRfqMappingByInternalRfq(token);
    if (mapping) {
      return this.buildRequestContext(mapping);
    }

    // Try client RFQ number
    mapping = await this.databaseService.getRfqMappingByClientRfq(token);
    if (mapping) {
      return this.buildRequestContext(mapping);
    }

    return null;
  }

  private async findBySubjectHeuristic(
    normalizedSubject: string,
    senderEmail: string,
    senderDomain: string,
    emailDate: Date,
  ): Promise<RequestContext | null> {
    // Use existing method to find similar subjects
    const mapping = await this.databaseService.findRfqBySubjectAndSender(
      normalizedSubject,
      senderEmail,
    );

    if (!mapping) return null;

    // Check date window (30 days)
    const thirtyDaysAgo = new Date(emailDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (mapping.receivedAt && mapping.receivedAt < thirtyDaysAgo) {
      // Too old, don't match
      return null;
    }

    return this.buildRequestContext(mapping);
  }

  private async buildRequestContext(mapping: any): Promise<RequestContext> {
    // Get client info if available
    let customerEmail = '';
    let customerDomain = '';

    if (mapping.clientId) {
      const client = await this.databaseService.getClientById(mapping.clientId);
      if (client) {
        customerEmail = client.email;
        customerDomain = this.extractDomain(client.email);
      }
    }

    // Map status
    const statusMap: Record<string, RequestStatus> = {
      pending: 'PENDING',
      processed: 'IN_PROGRESS',
      draft_pending: 'PENDING',
      sent: 'SENT_TO_SUPPLIER',
      completed: 'CLOSED',
      error: 'PENDING',
    };

    return {
      requestId: mapping.id,
      rfqId: mapping.id,
      internalRfqNumber: mapping.internalRfqNumber,
      clientRfqNumber: mapping.clientRfqNumber,
      emailSubject: mapping.emailSubject,
      customerEmail,
      customerDomain,
      status: statusMap[mapping.status] || 'PENDING',
      createdAt: mapping.processedAt,
      sentAt: undefined, // Will be resolved from Sent folder
      lastAutoReplyToCustomerAt: undefined, // Will be fetched from auto_email_logs
      ackCustomerSentAt: undefined, // Will be fetched from auto_email_logs
      autoReplyCount: 0, // Will be fetched from auto_email_logs
    };
  }
}
