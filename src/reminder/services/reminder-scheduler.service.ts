import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupplierReminderService } from './supplier-reminder.service';
import { CustomerAutoResponseService } from './customer-auto-response.service';
import { ConversationLinkerService } from './conversation-linker.service';
import { ReminderDatabaseService } from './reminder-database.service';
import { EmailService } from '../../email/email.service';
import { InboundEmail } from '../interfaces/reminder.interfaces';

/**
 * ReminderSchedulerService
 *
 * Handles scheduled jobs for:
 * 1. Supplier follow-up reminders (daily at configured hour)
 * 2. Customer inbound processing for ACK and auto-replies (every 5-10 min)
 */
@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private isProcessing = false;
  private isEnabled = true;
  private readonly reminderRunHour: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly supplierReminderService: SupplierReminderService,
    private readonly customerAutoResponseService: CustomerAutoResponseService,
    private readonly linkerService: ConversationLinkerService,
    private readonly reminderDbService: ReminderDatabaseService,
    private readonly emailService: EmailService,
  ) {
    this.reminderRunHour = this.configService.get<number>('reminder.reminderRunHour') || 9;
  }

  async onModuleInit() {
    this.logger.log('ReminderSchedulerService initialized');
    this.logger.log(`Supplier reminder run hour: ${this.reminderRunHour}:00 (Africa/Abidjan)`);
  }

  /**
   * Daily job for supplier follow-up reminders.
   * Runs at configured hour (default 9 AM) Africa/Abidjan timezone.
   */
  @Cron('0 0 9 * * *', {
    name: 'supplier-follow-up',
    timeZone: 'Africa/Abidjan',
  })
  async runSupplierReminders() {
    if (!this.isEnabled) {
      this.logger.debug('Supplier reminder job disabled');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('Supplier reminder job already running, skipping');
      return;
    }

    this.isProcessing = true;
    this.logger.log('Starting supplier reminder job');

    try {
      const stats = await this.supplierReminderService.processDueReminders();

      this.logger.log(
        `Supplier reminder job completed: ${stats.sent}/${stats.processed} sent`,
      );
    } catch (error) {
      this.logger.error(`Supplier reminder job error: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Frequent job for customer inbound processing.
   * Runs every 10 minutes to check for new customer emails.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: 'customer-inbound-processing',
  })
  async runCustomerInboundProcessing() {
    if (!this.isEnabled) {
      this.logger.debug('Customer inbound processing disabled');
      return;
    }

    if (this.isProcessing) {
      this.logger.debug('Customer inbound processing already running, skipping');
      return;
    }

    this.isProcessing = true;
    this.logger.debug('Starting customer inbound processing');

    try {
      const stats = await this.processCustomerInbound();

      if (stats.processed > 0) {
        this.logger.log(
          `Customer inbound processing: ${stats.processed} emails, ${stats.ackSent} ACKs, ${stats.autoReplySent} auto-replies`,
        );
      }
    } catch (error) {
      this.logger.error(`Customer inbound processing error: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process customer inbound emails for ACK and auto-replies.
   */
  private async processCustomerInbound(): Promise<{
    processed: number;
    ackSent: number;
    autoReplySent: number;
    skipped: number;
  }> {
    const stats = { processed: 0, ackSent: 0, autoReplySent: 0, skipped: 0 };

    try {
      // Fetch recent unread emails from INBOX
      // Note: We need to track which emails we've already processed
      const emails = await this.emailService.fetchEmails({
        folder: 'INBOX',
        unseen: true,
        limit: 50,
      });

      for (const email of emails) {
        stats.processed++;

        // Convert to InboundEmail format
        const inboundEmail = this.convertToInboundEmail(email);

        // Skip if already processed (check by message ID)
        const alreadyProcessed = await this.isEmailAlreadyProcessed(inboundEmail.messageId);
        if (alreadyProcessed) {
          stats.skipped++;
          continue;
        }

        // Process the email
        const result = await this.customerAutoResponseService.processInboundEmail(inboundEmail);

        switch (result.decision) {
          case 'SEND_ACK':
            stats.ackSent++;
            break;
          case 'SEND_AUTO_REPLY':
            stats.autoReplySent++;
            break;
          default:
            stats.skipped++;
        }
      }
    } catch (error) {
      this.logger.error(`Error in processCustomerInbound: ${error.message}`);
    }

    return stats;
  }

  /**
   * Convert email from EmailService format to InboundEmail format.
   */
  private convertToInboundEmail(email: any): InboundEmail {
    // Extract headers
    const headers: Record<string, string> = {};
    if (email.headers) {
      for (const [key, value] of Object.entries(email.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : String(value);
      }
    }

    // Extract references
    let references: string[] = [];
    if (headers['references']) {
      references = headers['references'].split(/\s+/).filter(r => r.startsWith('<'));
    }

    return {
      id: email.uid?.toString() || email.id,
      messageId: headers['message-id'] || email.messageId || '',
      threadId: email.threadId,
      from: email.from || '',
      to: Array.isArray(email.to) ? email.to : [email.to || ''],
      cc: email.cc ? (Array.isArray(email.cc) ? email.cc : [email.cc]) : [],
      subject: email.subject || '',
      bodyText: email.body || email.text || '',
      bodyHtml: email.html || '',
      date: email.date ? new Date(email.date) : new Date(),
      headers,
      inReplyTo: headers['in-reply-to'],
      references,
      attachments: email.attachments?.map((a: any) => ({
        filename: a.filename || a.name,
        contentType: a.contentType || a.type,
      })),
    };
  }

  /**
   * Check if an email has already been processed for auto-response.
   */
  private async isEmailAlreadyProcessed(messageId: string): Promise<boolean> {
    if (!messageId) return false;

    const logs = await this.reminderDbService.getAutoEmailLogs({
      limit: 100,
    });

    // Check if we've already sent an auto-response for this message
    return logs.some(log =>
      log.metadata?.inboundMessageId === messageId ||
      log.messageId === messageId
    );
  }

  /**
   * Enable/disable the scheduler.
   */
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    this.logger.log(`Reminder scheduler ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get scheduler status.
   */
  getStatus(): {
    enabled: boolean;
    isProcessing: boolean;
    reminderRunHour: number;
  } {
    return {
      enabled: this.isEnabled,
      isProcessing: this.isProcessing,
      reminderRunHour: this.reminderRunHour,
    };
  }

  /**
   * Manually trigger supplier reminder job.
   */
  async triggerSupplierReminders(): Promise<any> {
    return this.supplierReminderService.processDueReminders();
  }

  /**
   * Manually trigger customer inbound processing.
   */
  async triggerCustomerProcessing(): Promise<any> {
    return this.processCustomerInbound();
  }
}
