import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  CustomerConversation,
  AutoEmailLog,
  AutoEmailType,
  SupplierReminderDue,
} from '../interfaces/reminder.interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * ReminderDatabaseService
 *
 * Handles database operations for the reminder module.
 * Creates and manages tables for:
 * - customer_conversations
 * - auto_email_logs
 * - supplier_reminders
 */
@Injectable()
export class ReminderDatabaseService implements OnModuleInit {
  private readonly logger = new Logger(ReminderDatabaseService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit() {
    await this.createTables();
  }

  /**
   * Create reminder-specific tables
   */
  private async createTables() {
    const db = (this.databaseService as any).db;
    if (!db) {
      this.logger.warn('Database not initialized, skipping table creation');
      return;
    }

    try {
      // Customer Conversations table
      db.run(`
        CREATE TABLE IF NOT EXISTS customer_conversations (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          internal_rfq_number TEXT NOT NULL,
          customer_email TEXT NOT NULL,
          customer_domain TEXT,
          thread_id TEXT,
          first_inbound_at TEXT,
          last_inbound_at TEXT,
          ack_sent_at TEXT,
          ack_message_id TEXT,
          last_auto_reply_at TEXT,
          auto_reply_count INTEGER DEFAULT 0,
          last_supplier_reminder_at TEXT,
          supplier_reminder_count INTEGER DEFAULT 0,
          sent_to_supplier_at TEXT,
          sent_to_supplier_message_id TEXT,
          status TEXT DEFAULT 'PENDING',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(request_id, customer_email)
        )
      `);

      // Auto Email Logs table
      db.run(`
        CREATE TABLE IF NOT EXISTS auto_email_logs (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          request_id TEXT,
          rfq_id TEXT,
          internal_rfq_number TEXT,
          recipient_email TEXT NOT NULL,
          sender_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          message_id TEXT,
          thread_id TEXT,
          sent_at TEXT NOT NULL,
          status TEXT NOT NULL,
          error_message TEXT,
          metadata TEXT
        )
      `);

      // Supplier Reminders table
      db.run(`
        CREATE TABLE IF NOT EXISTS supplier_reminders (
          id TEXT PRIMARY KEY,
          rfq_id TEXT NOT NULL,
          internal_rfq_number TEXT NOT NULL,
          supplier_email TEXT NOT NULL,
          sent_at TEXT NOT NULL,
          due_date TEXT NOT NULL,
          original_due_date TEXT NOT NULL,
          was_postponed INTEGER DEFAULT 0,
          reminder_count INTEGER DEFAULT 0,
          last_reminder_at TEXT,
          last_reminder_message_id TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Create indexes
      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_request ON customer_conversations(request_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_conv_customer ON customer_conversations(customer_email)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_auto_log_type ON auto_email_logs(type)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_auto_log_request ON auto_email_logs(request_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_rem_due ON supplier_reminders(due_date)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_rem_status ON supplier_reminders(status)`);

      this.databaseService.saveToFile();
      this.logger.log('Reminder tables created/verified');
    } catch (error) {
      this.logger.error(`Error creating reminder tables: ${error.message}`);
    }
  }

  // ============ CUSTOMER CONVERSATIONS ============

  async getConversationByRequest(
    requestId: string,
    customerEmail: string,
  ): Promise<CustomerConversation | null> {
    const db = (this.databaseService as any).db;
    const result = db.exec(`
      SELECT * FROM customer_conversations
      WHERE request_id = ? AND customer_email = ?
    `, [requestId, customerEmail.toLowerCase()]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.mapRowToConversation(result[0].columns, result[0].values[0]);
  }

  async createOrUpdateConversation(
    requestId: string,
    internalRfqNumber: string,
    customerEmail: string,
    customerDomain?: string,
  ): Promise<CustomerConversation> {
    const db = (this.databaseService as any).db;
    const existing = await this.getConversationByRequest(requestId, customerEmail);

    if (existing) {
      const now = new Date().toISOString();
      db.run(`
        UPDATE customer_conversations
        SET last_inbound_at = ?, updated_at = ?
        WHERE id = ?
      `, [now, now, existing.id]);
      this.databaseService.saveToFile();
      return { ...existing, lastInboundAt: new Date(now), updatedAt: new Date(now) };
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(`
      INSERT INTO customer_conversations
      (id, request_id, internal_rfq_number, customer_email, customer_domain, first_inbound_at, last_inbound_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, requestId, internalRfqNumber, customerEmail.toLowerCase(), customerDomain || '', now, now, now, now]);

    this.databaseService.saveToFile();
    return (await this.getConversationByRequest(requestId, customerEmail))!;
  }

  async updateConversationAck(
    requestId: string,
    customerEmail: string,
    messageId?: string,
  ): Promise<boolean> {
    const db = (this.databaseService as any).db;
    const now = new Date().toISOString();

    // ATOMIC: Only update if ack_sent_at is NULL to prevent duplicate ACKs
    db.run(`
      UPDATE customer_conversations
      SET ack_sent_at = ?, ack_message_id = ?, updated_at = ?
      WHERE request_id = ? AND customer_email = ? AND ack_sent_at IS NULL
    `, [now, messageId || null, now, requestId, customerEmail.toLowerCase()]);

    // Check if update was successful (row was modified)
    const result = db.exec(`SELECT changes() as changed`);
    const changed = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;

    this.databaseService.saveToFile();
    return changed > 0;
  }

  async updateConversationAutoReply(
    requestId: string,
    customerEmail: string,
    messageId?: string,
  ): Promise<void> {
    const db = (this.databaseService as any).db;
    const now = new Date().toISOString();

    db.run(`
      UPDATE customer_conversations
      SET last_auto_reply_at = ?, auto_reply_count = auto_reply_count + 1, updated_at = ?
      WHERE request_id = ? AND customer_email = ?
    `, [now, now, requestId, customerEmail.toLowerCase()]);

    this.databaseService.saveToFile();
  }

  private mapRowToConversation(columns: string[], row: any[]): CustomerConversation {
    const obj: any = {};
    columns.forEach((col, i) => obj[col] = row[i]);

    return {
      id: obj.id,
      requestId: obj.request_id,
      internalRfqNumber: obj.internal_rfq_number,
      customerEmail: obj.customer_email,
      customerDomain: obj.customer_domain,
      threadId: obj.thread_id,
      firstInboundAt: obj.first_inbound_at ? new Date(obj.first_inbound_at) : undefined,
      lastInboundAt: obj.last_inbound_at ? new Date(obj.last_inbound_at) : undefined,
      ackSentAt: obj.ack_sent_at ? new Date(obj.ack_sent_at) : undefined,
      ackMessageId: obj.ack_message_id,
      lastAutoReplyAt: obj.last_auto_reply_at ? new Date(obj.last_auto_reply_at) : undefined,
      autoReplyCount: obj.auto_reply_count || 0,
      lastSupplierReminderAt: obj.last_supplier_reminder_at ? new Date(obj.last_supplier_reminder_at) : undefined,
      supplierReminderCount: obj.supplier_reminder_count || 0,
      sentToSupplierAt: obj.sent_to_supplier_at ? new Date(obj.sent_to_supplier_at) : undefined,
      sentToSupplierMessageId: obj.sent_to_supplier_message_id,
      status: obj.status,
      createdAt: new Date(obj.created_at),
      updatedAt: new Date(obj.updated_at),
    };
  }

  // ============ AUTO EMAIL LOGS ============

  async logAutoEmailEvent(log: {
    type: AutoEmailType | string;
    requestId?: string;
    rfqId?: string;
    internalRfqNumber?: string;
    recipientEmail: string;
    senderEmail: string;
    subject: string;
    messageId?: string;
    threadId?: string;
    status: 'sent' | 'failed' | 'skipped';
    errorMessage?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const db = (this.databaseService as any).db;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(`
      INSERT INTO auto_email_logs
      (id, type, request_id, rfq_id, internal_rfq_number, recipient_email, sender_email, subject, message_id, thread_id, sent_at, status, error_message, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      log.type,
      log.requestId || null,
      log.rfqId || null,
      log.internalRfqNumber || null,
      log.recipientEmail,
      log.senderEmail,
      log.subject,
      log.messageId || null,
      log.threadId || null,
      now,
      log.status,
      log.errorMessage || null,
      log.metadata ? JSON.stringify(log.metadata) : null,
    ]);

    this.databaseService.saveToFile();
    return id;
  }

  async getAutoEmailLogs(
    filters?: { type?: AutoEmailType; requestId?: string; limit?: number },
  ): Promise<AutoEmailLog[]> {
    const db = (this.databaseService as any).db;
    let query = `SELECT * FROM auto_email_logs WHERE 1=1`;
    const params: any[] = [];

    if (filters?.type) {
      query += ` AND type = ?`;
      params.push(filters.type);
    }
    if (filters?.requestId) {
      query += ` AND request_id = ?`;
      params.push(filters.requestId);
    }

    query += ` ORDER BY sent_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT ?`;
      params.push(filters.limit);
    }

    const result = db.exec(query, params);
    if (result.length === 0) return [];

    return result[0].values.map((row: any) => this.mapRowToAutoEmailLog(result[0].columns, row));
  }

  private mapRowToAutoEmailLog(columns: string[], row: any[]): AutoEmailLog {
    const obj: any = {};
    columns.forEach((col, i) => obj[col] = row[i]);

    return {
      id: obj.id,
      type: obj.type as AutoEmailType,
      requestId: obj.request_id,
      rfqId: obj.rfq_id,
      internalRfqNumber: obj.internal_rfq_number,
      recipientEmail: obj.recipient_email,
      senderEmail: obj.sender_email,
      subject: obj.subject,
      messageId: obj.message_id,
      threadId: obj.thread_id,
      sentAt: new Date(obj.sent_at),
      status: obj.status,
      errorMessage: obj.error_message,
      metadata: obj.metadata ? JSON.parse(obj.metadata) : undefined,
    };
  }

  // ============ SUPPLIER REMINDERS ============

  async createSupplierReminder(reminder: {
    rfqId: string;
    internalRfqNumber: string;
    supplierEmail: string;
    sentAt: Date;
    dueDate: Date;
    originalDueDate: Date;
    wasPostponed: boolean;
  }): Promise<string> {
    const db = (this.databaseService as any).db;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.run(`
      INSERT INTO supplier_reminders
      (id, rfq_id, internal_rfq_number, supplier_email, sent_at, due_date, original_due_date, was_postponed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      reminder.rfqId,
      reminder.internalRfqNumber,
      reminder.supplierEmail,
      reminder.sentAt.toISOString(),
      reminder.dueDate.toISOString(),
      reminder.originalDueDate.toISOString(),
      reminder.wasPostponed ? 1 : 0,
      now,
      now,
    ]);

    this.databaseService.saveToFile();
    return id;
  }

  async getDueSupplierReminders(now?: Date): Promise<SupplierReminderDue[]> {
    const db = (this.databaseService as any).db;
    const currentTime = (now || new Date()).toISOString();

    const result = db.exec(`
      SELECT * FROM supplier_reminders
      WHERE status = 'pending' AND due_date <= ?
      ORDER BY due_date ASC
    `, [currentTime]);

    if (result.length === 0) return [];

    return result[0].values.map((row: any) => {
      const obj: any = {};
      result[0].columns.forEach((col: string, i: number) => obj[col] = row[i]);

      return {
        rfqId: obj.rfq_id,
        internalRfqNumber: obj.internal_rfq_number,
        supplierEmail: obj.supplier_email,
        sentAt: new Date(obj.sent_at),
        dueDate: new Date(obj.due_date),
        originalDueDate: new Date(obj.original_due_date),
        wasPostponed: obj.was_postponed === 1,
        reminderCount: obj.reminder_count || 0,
      };
    });
  }

  async updateSupplierReminderSent(
    rfqId: string,
    messageId?: string,
    nextDueDate?: Date,
  ): Promise<void> {
    const db = (this.databaseService as any).db;
    const now = new Date().toISOString();

    if (nextDueDate) {
      // Update for next reminder
      db.run(`
        UPDATE supplier_reminders
        SET last_reminder_at = ?, last_reminder_message_id = ?, reminder_count = reminder_count + 1, due_date = ?, updated_at = ?
        WHERE rfq_id = ?
      `, [now, messageId || null, nextDueDate.toISOString(), now, rfqId]);
    } else {
      // Mark as completed
      db.run(`
        UPDATE supplier_reminders
        SET last_reminder_at = ?, last_reminder_message_id = ?, reminder_count = reminder_count + 1, status = 'completed', updated_at = ?
        WHERE rfq_id = ?
      `, [now, messageId || null, now, rfqId]);
    }

    this.databaseService.saveToFile();
  }

  async markSupplierReminderResponded(rfqId: string): Promise<void> {
    const db = (this.databaseService as any).db;
    const now = new Date().toISOString();

    db.run(`
      UPDATE supplier_reminders
      SET status = 'responded', updated_at = ?
      WHERE rfq_id = ?
    `, [now, rfqId]);

    this.databaseService.saveToFile();
  }
}
