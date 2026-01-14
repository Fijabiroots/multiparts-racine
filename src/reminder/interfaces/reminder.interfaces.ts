/**
 * Interfaces for the Email Reminder / Customer Reassurance module
 */

// ============ CONFIGURATION ============

export interface ReminderConfig {
  reminderSlaDays: number;
  reminderRunHour: number;
  autoReplyThrottleHours: number;
  multipartsAckFrom: string;
  procurementSentMailbox: string;
  chaserScoreThreshold: number;
  closedStatuses: RequestStatus[];
}

// ============ REQUEST STATUS ============

export type RequestStatus =
  | 'DRAFT'
  | 'NEW'
  | 'UNLINKED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'QUOTED'
  | 'SENT_TO_SUPPLIER'
  | 'AWAITING_SUPPLIER'
  | 'SUPPLIER_RESPONDED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'LOST'
  | 'WON';

export type RequestState = 'NEVER_TREATED' | 'TREATED' | 'IN_PROGRESS';

// ============ EMAIL TYPES ============

export interface InboundEmail {
  id: string;
  messageId: string;
  threadId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  date: Date;
  headers: Record<string, string>;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; contentType: string }[];
}

export interface SentEmailInfo {
  messageId: string;
  threadId?: string;
  sentAt: Date;
  to: string[];
  subject: string;
  rfqToken?: string;
}

// ============ CONVERSATION LINKING ============

export interface RequestContext {
  requestId: string;
  rfqId?: string;
  internalRfqNumber: string;
  clientRfqNumber?: string;
  customerEmail: string;
  customerDomain: string;
  status: RequestStatus;
  createdAt: Date;
  sentAt?: Date;
  lastAutoReplyToCustomerAt?: Date;
  ackCustomerSentAt?: Date;
  autoReplyCount: number;
}

export interface LinkResult {
  linked: boolean;
  requestContext?: RequestContext;
  matchMethod?: 'thread_id' | 'in_reply_to' | 'references' | 'rfq_token' | 'subject_heuristic';
  confidence: number;
}

export interface SentDateResult {
  found: boolean;
  sentAt?: Date;
  messageId?: string;
  threadId?: string;
  matchMethod?: 'message_id' | 'thread_id' | 'rfq_token_subject' | 'rfq_token_body';
}

// ============ CLASSIFIER ============

export type ClassifierDecision =
  | 'CHASER'
  | 'NOT_CHASER'
  | 'NOT_LINKED'
  | 'NEW_REQUEST'
  | 'BLOCKED_INTERNAL'
  | 'BLOCKED_AUTO_REPLY'
  | 'BLOCKED_CLOSED_STATUS';

export interface ClassifierResult {
  decision: ClassifierDecision;
  score: number;
  reasons: string[];
  triggeredRules: TriggeredRule[];
  requestState?: RequestState;
}

export interface TriggeredRule {
  rule: string;
  points: number;
  match?: string;
  location: 'subject' | 'body' | 'context' | 'guard';
}

// ============ AUTO-RESPONSE DECISION ============

export type AutoResponseDecision =
  | 'SEND_ACK'
  | 'SEND_AUTO_REPLY'
  | 'SKIP_THROTTLED'
  | 'SKIP_NEVER_TREATED'
  | 'SKIP_NOT_CHASER'
  | 'SKIP_BLOCKED'
  | 'SKIP_NO_LINK';

export interface AutoResponseResult {
  decision: AutoResponseDecision;
  classifierResult?: ClassifierResult;
  linkResult?: LinkResult;
  throttleInfo?: {
    lastReplyAt: Date;
    hoursRemaining: number;
  };
  emailSent?: boolean;
  sentMessageId?: string;
}

// ============ SUPPLIER REMINDER ============

export interface SupplierReminderDue {
  rfqId: string;
  internalRfqNumber: string;
  supplierEmail: string;
  sentAt: Date;
  dueDate: Date;
  originalDueDate: Date;
  wasPostponed: boolean;
  reminderCount: number;
}

export interface ReminderScheduleResult {
  dueDate: Date;
  originalDueDate: Date;
  wasPostponed: boolean;
  postponeReason?: 'saturday' | 'sunday';
}

// ============ AUTO EMAIL LOG ============

export type AutoEmailType =
  | 'ACK_CUSTOMER_FIRST_RECEIPT'
  | 'AUTO_REPLY_CUSTOMER_CHASER'
  | 'SUPPLIER_FOLLOW_UP_REMINDER';

export interface AutoEmailLog {
  id: string;
  type: AutoEmailType;
  requestId?: string;
  rfqId?: string;
  internalRfqNumber?: string;
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  messageId?: string;
  threadId?: string;
  sentAt: Date;
  status: 'sent' | 'failed';
  errorMessage?: string;
  metadata?: Record<string, any>;
}

// ============ CUSTOMER CONVERSATION ============

export interface CustomerConversation {
  id: string;
  requestId: string;
  internalRfqNumber: string;
  customerEmail: string;
  customerDomain: string;
  threadId?: string;
  firstInboundAt?: Date;
  lastInboundAt?: Date;
  ackSentAt?: Date;
  ackMessageId?: string;
  lastAutoReplyAt?: Date;
  autoReplyCount: number;
  lastSupplierReminderAt?: Date;
  supplierReminderCount: number;
  sentToSupplierAt?: Date;
  sentToSupplierMessageId?: string;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ============ CHASER KEYWORDS CONFIG ============

export interface ChaserKeywordsConfig {
  subjectStrong: {
    fr: string[];
    en: string[];
  };
  subjectUrgent: string[];
  bodyStrong: {
    fr: string[];
    en: string[];
  };
  bodyQuestions: {
    fr: string[];
    en: string[];
  };
  temporalIndicators: string[];
  newRequestIndicators: {
    fr: string[];
    en: string[];
  };
  purchaseOrderIndicators: {
    fr: string[];
    en: string[];
  };
  deliveryIndicators: {
    fr: string[];
    en: string[];
  };
  cancellationIndicators: {
    fr: string[];
    en: string[];
  };
  signatureMarkers: string[];
}
