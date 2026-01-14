import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReminderPolicyService } from './reminder-policy.service';
import { ConversationLinkerService } from './conversation-linker.service';
import { ReminderDatabaseService } from './reminder-database.service';
import { ReminderMailService } from './reminder-mail.service';
import { SupplierReminderDue, SentDateResult } from '../interfaces/reminder.interfaces';
import { DatabaseService } from '../../database/database.service';
import { EmailService } from '../../email/email.service';

/**
 * SupplierReminderService
 *
 * Handles supplier follow-up reminders based on:
 * 1. Actual sent date from procurement@ Sent folder (NOT creation date)
 * 2. Weekend rule: reminders due on Sat/Sun are postponed to Monday
 */
@Injectable()
export class SupplierReminderService {
  private readonly logger = new Logger(SupplierReminderService.name);
  private readonly procurementMailbox: string;
  private readonly slaDays: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly policyService: ReminderPolicyService,
    private readonly linkerService: ConversationLinkerService,
    private readonly reminderDbService: ReminderDatabaseService,
    private readonly mailService: ReminderMailService,
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
  ) {
    this.procurementMailbox = this.configService.get<string>('reminder.procurementSentMailbox') || 'procurement@multipartsci.com';
    this.slaDays = this.configService.get<number>('reminder.reminderSlaDays') || 3;
  }

  /**
   * Process all due supplier reminders.
   * Called by the scheduler job.
   */
  async processDueReminders(): Promise<{
    processed: number;
    sent: number;
    skipped: number;
    errors: number;
  }> {
    const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };

    try {
      // Get all due reminders
      const dueReminders = await this.reminderDbService.getDueSupplierReminders();
      this.logger.log(`Found ${dueReminders.length} due supplier reminders`);

      for (const reminder of dueReminders) {
        stats.processed++;

        try {
          // Check if today is a business day
          const today = new Date();
          if (!this.policyService.isBusinessDay(today)) {
            this.logger.debug(`Skipping reminder for ${reminder.internalRfqNumber} - not a business day`);
            stats.skipped++;
            continue;
          }

          // Get original email subject from RFQ mapping
          const rfqMapping = await this.databaseService.getRfqMappingByInternalRfq(reminder.internalRfqNumber);
          const originalSubject = rfqMapping?.emailSubject || `Demande de Prix ${reminder.internalRfqNumber}`;

          // Send reminder
          const result = await this.mailService.sendSupplierReminder({
            supplierEmail: reminder.supplierEmail,
            internalRfqNumber: reminder.internalRfqNumber,
            originalSubject,
            reminderCount: reminder.reminderCount,
            requestId: reminder.rfqId,
          });

          if (result.success) {
            // Calculate next reminder date (if we want to send more)
            const nextSchedule = this.policyService.calculateNextReminderDate(
              new Date(),
              reminder.reminderCount + 1,
            );

            // Update reminder status
            await this.reminderDbService.updateSupplierReminderSent(
              reminder.rfqId,
              result.messageId,
              reminder.reminderCount < 3 ? nextSchedule.dueDate : undefined, // Max 4 reminders
            );

            stats.sent++;
            this.logger.log(`Sent reminder #${reminder.reminderCount + 1} for ${reminder.internalRfqNumber}`);
          } else {
            stats.errors++;
            this.logger.error(`Failed to send reminder for ${reminder.internalRfqNumber}: ${result.error}`);
          }
        } catch (error) {
          stats.errors++;
          this.logger.error(`Error processing reminder for ${reminder.internalRfqNumber}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error in processDueReminders: ${error.message}`);
    }

    this.logger.log(
      `Reminder processing complete: ${stats.processed} processed, ${stats.sent} sent, ${stats.skipped} skipped, ${stats.errors} errors`,
    );

    return stats;
  }

  /**
   * Schedule a reminder for a newly sent RFQ to supplier.
   *
   * @param rfqId - The RFQ ID
   * @param internalRfqNumber - The internal RFQ number
   * @param supplierEmail - The supplier email
   * @param sentAt - Optional: if not provided, will try to resolve from Sent folder
   */
  async scheduleReminderForRfq(
    rfqId: string,
    internalRfqNumber: string,
    supplierEmail: string,
    sentAt?: Date,
  ): Promise<{ scheduled: boolean; dueDate?: Date; error?: string }> {
    try {
      // If sentAt not provided, try to resolve from Sent folder
      let actualSentAt = sentAt;

      if (!actualSentAt) {
        const sentResult = await this.resolveSentDate(internalRfqNumber);

        if (!sentResult.found) {
          this.logger.debug(`RFQ ${internalRfqNumber} not found in Sent folder - not scheduling reminder`);
          return { scheduled: false, error: 'NOT_SENT' };
        }

        actualSentAt = sentResult.sentAt;
      }

      // Calculate due date with weekend rule
      const schedule = this.policyService.computeNextBusinessDueDate(actualSentAt!, this.slaDays);

      // Create reminder record
      await this.reminderDbService.createSupplierReminder({
        rfqId,
        internalRfqNumber,
        supplierEmail,
        sentAt: actualSentAt!,
        dueDate: schedule.dueDate,
        originalDueDate: schedule.originalDueDate,
        wasPostponed: schedule.wasPostponed,
      });

      this.logger.log(
        `Scheduled reminder for ${internalRfqNumber}: due ${schedule.dueDate.toISOString()}${
          schedule.wasPostponed ? ` (postponed from ${schedule.postponeReason})` : ''
        }`,
      );

      return {
        scheduled: true,
        dueDate: schedule.dueDate,
      };
    } catch (error) {
      this.logger.error(`Error scheduling reminder for ${internalRfqNumber}: ${error.message}`);
      return { scheduled: false, error: error.message };
    }
  }

  /**
   * Resolve sent date for an RFQ from procurement@ Sent folder.
   */
  async resolveSentDate(internalRfqNumber: string): Promise<SentDateResult> {
    try {
      // Fetch recent sent emails from procurement mailbox
      // Note: This requires the email service to support fetching from Sent folder
      // For now, we'll implement a simplified version

      const sentEmails = await this.fetchSentEmails(30); // Last 30 days

      return this.linkerService.resolveSentDateForRfq(internalRfqNumber, sentEmails);
    } catch (error) {
      this.logger.error(`Error resolving sent date for ${internalRfqNumber}: ${error.message}`);
      return { found: false };
    }
  }

  /**
   * Fetch sent emails from procurement mailbox.
   * TODO: Implement proper IMAP connection to procurement@
   */
  private async fetchSentEmails(
    daysBack: number,
  ): Promise<Array<{ messageId: string; subject: string; body: string; date: Date; threadId?: string }>> {
    try {
      // This would need to connect to procurement@ mailbox Sent folder
      // For now, return empty array - implement when IMAP multi-account is set up

      this.logger.warn('fetchSentEmails not fully implemented - returning empty array');
      return [];
    } catch (error) {
      this.logger.error(`Error fetching sent emails: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark a supplier reminder as responded (when supplier sends a quote).
   */
  async markAsResponded(rfqId: string): Promise<void> {
    await this.reminderDbService.markSupplierReminderResponded(rfqId);
    this.logger.log(`Marked reminder for RFQ ${rfqId} as responded`);
  }

  /**
   * Get all pending reminders for monitoring/dashboard.
   */
  async getPendingReminders(): Promise<SupplierReminderDue[]> {
    // Get all due reminders (past due date)
    return this.reminderDbService.getDueSupplierReminders();
  }
}
