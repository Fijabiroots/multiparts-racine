import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReminderScheduleResult } from '../interfaces/reminder.interfaces';

/**
 * ReminderPolicyService
 *
 * Handles business day calculations and reminder scheduling policies.
 * Implements weekend rule: if due date falls on Saturday or Sunday,
 * postpone to the following Monday.
 */
@Injectable()
export class ReminderPolicyService {
  private readonly logger = new Logger(ReminderPolicyService.name);
  private readonly slaDays: number;

  constructor(private readonly configService: ConfigService) {
    this.slaDays = this.configService.get<number>('reminder.reminderSlaDays') || 3;
  }

  /**
   * Compute the next business due date for a reminder.
   *
   * @param sentAt - The date the RFQ was sent to supplier
   * @param slaDays - Number of days to add (default from config)
   * @returns ReminderScheduleResult with due date and postpone info
   */
  computeNextBusinessDueDate(
    sentAt: Date,
    slaDays?: number,
  ): ReminderScheduleResult {
    const days = slaDays ?? this.slaDays;

    // Calculate raw due date by adding SLA days
    const originalDueDate = new Date(sentAt);
    originalDueDate.setDate(originalDueDate.getDate() + days);
    originalDueDate.setHours(9, 0, 0, 0); // Set to 9 AM

    // Check if it falls on weekend
    const dayOfWeek = originalDueDate.getDay();
    let dueDate = new Date(originalDueDate);
    let wasPostponed = false;
    let postponeReason: 'saturday' | 'sunday' | undefined;

    if (dayOfWeek === 6) {
      // Saturday -> Monday (+2 days)
      dueDate.setDate(dueDate.getDate() + 2);
      wasPostponed = true;
      postponeReason = 'saturday';
      this.logger.debug(`Due date ${originalDueDate.toISOString()} falls on Saturday, postponed to Monday ${dueDate.toISOString()}`);
    } else if (dayOfWeek === 0) {
      // Sunday -> Monday (+1 day)
      dueDate.setDate(dueDate.getDate() + 1);
      wasPostponed = true;
      postponeReason = 'sunday';
      this.logger.debug(`Due date ${originalDueDate.toISOString()} falls on Sunday, postponed to Monday ${dueDate.toISOString()}`);
    }

    return {
      dueDate,
      originalDueDate,
      wasPostponed,
      postponeReason,
    };
  }

  /**
   * Check if a date is a business day (Monday-Friday)
   */
  isBusinessDay(date: Date): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek !== 0 && dayOfWeek !== 6;
  }

  /**
   * Get the next business day from a given date
   */
  getNextBusinessDay(date: Date): Date {
    const result = new Date(date);
    const dayOfWeek = result.getDay();

    if (dayOfWeek === 6) {
      // Saturday -> Monday
      result.setDate(result.getDate() + 2);
    } else if (dayOfWeek === 0) {
      // Sunday -> Monday
      result.setDate(result.getDate() + 1);
    }

    return result;
  }

  /**
   * Add business days to a date (skipping weekends)
   */
  addBusinessDays(startDate: Date, businessDays: number): Date {
    const result = new Date(startDate);
    let daysAdded = 0;

    while (daysAdded < businessDays) {
      result.setDate(result.getDate() + 1);
      if (this.isBusinessDay(result)) {
        daysAdded++;
      }
    }

    return result;
  }

  /**
   * Check if a reminder is due now (or overdue)
   */
  isReminderDue(dueDate: Date, now?: Date): boolean {
    const currentTime = now || new Date();
    return dueDate <= currentTime;
  }

  /**
   * Get the number of business days between two dates
   */
  getBusinessDaysBetween(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);

    while (current < endDate) {
      current.setDate(current.getDate() + 1);
      if (this.isBusinessDay(current)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Determine reminder urgency level based on days elapsed
   */
  getReminderUrgency(sentAt: Date, now?: Date): 'normal' | 'urgent' | 'critical' {
    const currentTime = now || new Date();
    const businessDays = this.getBusinessDaysBetween(sentAt, currentTime);

    if (businessDays <= this.slaDays) {
      return 'normal';
    } else if (businessDays <= this.slaDays * 2) {
      return 'urgent';
    } else {
      return 'critical';
    }
  }

  /**
   * Calculate the next reminder date after a previous reminder
   * Uses exponential backoff: 3 days, 5 days, 7 days, etc.
   */
  calculateNextReminderDate(
    lastReminderDate: Date,
    reminderCount: number,
  ): ReminderScheduleResult {
    // Exponential backoff: base + (count * 2)
    const baseDays = this.slaDays;
    const additionalDays = Math.min(reminderCount * 2, 7); // Cap at 7 additional days
    const totalDays = baseDays + additionalDays;

    return this.computeNextBusinessDueDate(lastReminderDate, totalDays);
  }
}
