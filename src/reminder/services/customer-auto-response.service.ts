import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InboundEmail,
  AutoResponseDecision,
  AutoResponseResult,
  RequestContext,
  AutoEmailType,
  RequestState,
} from '../interfaces/reminder.interfaces';
import { ConversationLinkerService } from './conversation-linker.service';
import { ClassifierClientChaserService } from './classifier-client-chaser.service';
import { ReminderDatabaseService } from './reminder-database.service';
import { ReminderMailService } from './reminder-mail.service';

/**
 * CustomerAutoResponseService
 *
 * Decision engine that determines if and what auto-response to send.
 * Integrates the classifier but makes the final business decision.
 *
 * KEY RULE: Never auto-respond to NEVER_TREATED requests.
 */
@Injectable()
export class CustomerAutoResponseService {
  private readonly logger = new Logger(CustomerAutoResponseService.name);
  private readonly throttleHours: number;
  private readonly ackFromEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly linkerService: ConversationLinkerService,
    private readonly classifierService: ClassifierClientChaserService,
    private readonly reminderDbService: ReminderDatabaseService,
    private readonly mailService: ReminderMailService,
  ) {
    this.throttleHours = this.configService.get<number>('reminder.autoReplyThrottleHours') || 12;
    this.ackFromEmail = this.configService.get<string>('reminder.multipartsAckFrom') || 'rafiou.oyeossi@multipartsci.com';
  }

  /**
   * Process an inbound customer email and determine auto-response.
   *
   * Decision tree:
   * 1. Try to link email to existing request
   * 2. If NOT_LINKED or NEVER_TREATED -> Create new ticket, no auto-reply
   * 3. If linked and treated:
   *    a. Check if first receipt -> send ACK
   *    b. Classify as chaser -> check throttle -> send auto-reply
   */
  async processInboundEmail(email: InboundEmail): Promise<AutoResponseResult> {
    const senderEmail = this.linkerService.extractEmail(email.from);

    // Step 1: Link to existing request
    const linkResult = await this.linkerService.matchInboundCustomerEmailToRequest(email);

    // Step 2: Determine request state
    const requestContext = linkResult.requestContext;
    const requestState = this.classifierService.determineRequestState(requestContext);

    // ============ Priority Rule: NEVER_TREATED ============
    if (requestState === 'NEVER_TREATED') {
      this.logger.log(
        `AUTO_REPLY_SKIPPED_NEVER_TREATED: from=${senderEmail}, subject="${email.subject}"`,
      );

      // Log for audit
      await this.reminderDbService.logAutoEmailEvent({
        type: 'AUTO_REPLY_CUSTOMER_CHASER',
        recipientEmail: senderEmail,
        senderEmail: this.ackFromEmail,
        subject: email.subject,
        status: 'skipped',
        metadata: {
          event: 'AUTO_REPLY_SKIPPED_NEVER_TREATED',
          inboundMessageId: email.messageId,
          requestState,
          linkResult: linkResult.linked ? linkResult.matchMethod : 'NOT_LINKED',
        },
      });

      // TODO: Create new ticket / label as NEW_RFQ_PENDING

      return {
        decision: 'SKIP_NEVER_TREATED',
        linkResult,
        classifierResult: {
          decision: 'NEW_REQUEST',
          score: 0,
          reasons: ['Request never treated - no auto-reply allowed'],
          triggeredRules: [],
          requestState,
        },
      };
    }

    // ============ Not Linked Case ============
    if (!linkResult.linked || !requestContext) {
      this.logger.debug(`No link found for email from ${senderEmail}`);

      return {
        decision: 'SKIP_NO_LINK',
        linkResult,
      };
    }

    // ============ Linked Request - Check for ACK ============

    // IMPORTANT: Create or update conversation FIRST to ensure record exists
    // This prevents race conditions where multiple emails trigger duplicate ACKs
    await this.reminderDbService.createOrUpdateConversation(
      requestContext.requestId,
      requestContext.internalRfqNumber,
      senderEmail,
      this.linkerService.extractDomain(senderEmail),
    );

    // Re-fetch conversation to get current state (including ackSentAt)
    const conversation = await this.reminderDbService.getConversationByRequest(
      requestContext.requestId,
      senderEmail,
    );

    // Check if first receipt (no ACK sent yet)
    if (conversation && !conversation.ackSentAt) {
      // Send first receipt ACK
      const ackResult = await this.sendFirstReceiptAck(email, requestContext);

      if (ackResult.emailSent) {
        // ATOMIC: Update conversation with ACK info (returns false if already set by concurrent process)
        const wasUpdated = await this.reminderDbService.updateConversationAck(
          requestContext.requestId,
          senderEmail,
          ackResult.sentMessageId,
        );

        if (wasUpdated) {
          return {
            decision: 'SEND_ACK',
            linkResult,
            emailSent: true,
            sentMessageId: ackResult.sentMessageId,
          };
        } else {
          // ACK was already sent by concurrent process - log duplicate attempt
          this.logger.warn(
            `Duplicate ACK attempt for ${requestContext.internalRfqNumber} to ${senderEmail} - skipped (race condition)`,
          );
        }
      }
    }

    // ============ Classify as Chaser ============

    const classifierResult = await this.classifierService.classify(email, requestContext);

    // If blocked by guard rules
    if (['BLOCKED_INTERNAL', 'BLOCKED_AUTO_REPLY', 'BLOCKED_CLOSED_STATUS'].includes(classifierResult.decision)) {
      return {
        decision: 'SKIP_BLOCKED',
        linkResult,
        classifierResult,
      };
    }

    // If not a chaser
    if (classifierResult.decision !== 'CHASER') {
      return {
        decision: 'SKIP_NOT_CHASER',
        linkResult,
        classifierResult,
      };
    }

    // ============ Throttle Check ============

    const lastAutoReplyAt = conversation?.lastAutoReplyAt;
    if (lastAutoReplyAt) {
      const hoursSinceLastReply = (Date.now() - lastAutoReplyAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastReply < this.throttleHours) {
        const hoursRemaining = this.throttleHours - hoursSinceLastReply;

        this.logger.debug(
          `Throttled auto-reply for ${senderEmail}: ${hoursRemaining.toFixed(1)}h remaining`,
        );

        return {
          decision: 'SKIP_THROTTLED',
          linkResult,
          classifierResult,
          throttleInfo: {
            lastReplyAt: lastAutoReplyAt,
            hoursRemaining,
          },
        };
      }
    }

    // ============ Send Auto-Reply ============

    const autoReplyResult = await this.sendChaserAutoReply(email, requestContext);

    if (autoReplyResult.emailSent) {
      // Update conversation
      await this.reminderDbService.updateConversationAutoReply(
        requestContext.requestId,
        senderEmail,
        autoReplyResult.sentMessageId,
      );

      return {
        decision: 'SEND_AUTO_REPLY',
        linkResult,
        classifierResult,
        emailSent: true,
        sentMessageId: autoReplyResult.sentMessageId,
      };
    }

    return {
      decision: 'SKIP_NOT_CHASER',
      linkResult,
      classifierResult,
    };
  }

  /**
   * Send first receipt acknowledgment to customer.
   */
  private async sendFirstReceiptAck(
    email: InboundEmail,
    requestContext: RequestContext,
  ): Promise<{ emailSent: boolean; sentMessageId?: string }> {
    const senderEmail = this.linkerService.extractEmail(email.from);

    const subject = `Re: ${email.subject}`;
    const body = this.buildAckBody(requestContext, email.subject);

    try {
      const result = await this.mailService.sendAutoEmail({
        type: 'ACK_CUSTOMER_FIRST_RECEIPT',
        from: this.ackFromEmail,
        to: senderEmail,
        subject,
        body,
        inReplyTo: email.messageId,
        references: [email.messageId, ...(email.references || [])],
        requestId: requestContext.requestId,
        internalRfqNumber: requestContext.internalRfqNumber,
      });

      this.logger.log(
        `ACK sent to ${senderEmail} for ${requestContext.internalRfqNumber}: ${result.messageId}`,
      );

      return {
        emailSent: true,
        sentMessageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send ACK to ${senderEmail}: ${error.message}`);
      return { emailSent: false };
    }
  }

  /**
   * Send auto-reply to customer chaser.
   */
  private async sendChaserAutoReply(
    email: InboundEmail,
    requestContext: RequestContext,
  ): Promise<{ emailSent: boolean; sentMessageId?: string }> {
    const senderEmail = this.linkerService.extractEmail(email.from);

    // Clean subject (remove multiple Re:)
    let subject = email.subject;
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    const body = this.buildChaserReplyBody(requestContext);

    try {
      const result = await this.mailService.sendAutoEmail({
        type: 'AUTO_REPLY_CUSTOMER_CHASER',
        from: this.ackFromEmail,
        to: senderEmail,
        subject,
        body,
        inReplyTo: email.messageId,
        references: [email.messageId, ...(email.references || [])],
        requestId: requestContext.requestId,
        internalRfqNumber: requestContext.internalRfqNumber,
      });

      this.logger.log(
        `Auto-reply sent to ${senderEmail} for ${requestContext.internalRfqNumber}: ${result.messageId}`,
      );

      return {
        emailSent: true,
        sentMessageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send auto-reply to ${senderEmail}: ${error.message}`);
      return { emailSent: false };
    }
  }

  /**
   * Build ACK email body
   * Includes client RFQ number if available, otherwise uses email subject
   */
  private buildAckBody(requestContext: RequestContext, emailSubject?: string): string {
    // Determine the client reference to display
    let clientReference = '';
    if (requestContext.clientRfqNumber) {
      clientReference = `\nVotre référence : ${requestContext.clientRfqNumber}`;
    } else if (emailSubject) {
      // Clean subject: remove Re:, Fwd:, etc.
      const cleanSubject = emailSubject
        .replace(/^(re|fwd|fw|tr):\s*/gi, '')
        .trim();
      if (cleanSubject) {
        clientReference = `\nObjet : ${cleanSubject}`;
      }
    }

    return `Bonjour,

Nous accusons bonne réception de votre demande.

Réf. interne : ${requestContext.internalRfqNumber}${clientReference}

Votre demande est en cours de traitement par nos équipes.
Nous revenons vers vous dans les meilleurs délais avec une proposition.

Cordialement,
MULTIPARTS – Rafiou OYEOSSI`;
  }

  /**
   * Build chaser auto-reply body
   */
  private buildChaserReplyBody(requestContext: RequestContext, emailSubject?: string): string {
    // Determine the client reference to display
    let clientReference = '';
    if (requestContext.clientRfqNumber) {
      clientReference = ` / Votre réf. : ${requestContext.clientRfqNumber}`;
    }

    return `Bonjour,

Merci pour votre relance. Votre demande (Réf. ${requestContext.internalRfqNumber}${clientReference}) est toujours en cours de traitement par nos équipes.

Nous revenons vers vous dès que possible avec une mise à jour.

Cordialement,
MULTIPARTS – Rafiou OYEOSSI`;
  }
}
