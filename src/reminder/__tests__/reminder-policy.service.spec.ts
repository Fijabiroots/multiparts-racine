import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ReminderPolicyService } from '../services/reminder-policy.service';

describe('ReminderPolicyService', () => {
  let service: ReminderPolicyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderPolicyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'reminder.reminderSlaDays') return 3;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ReminderPolicyService>(ReminderPolicyService);
  });

  describe('computeNextBusinessDueDate', () => {
    it('should return due date on weekday when original due date is weekday', () => {
      // Create a Monday (we use local time, ensure Monday)
      const sentAt = new Date(2026, 0, 12, 10, 0, 0); // January 12, 2026 is Monday
      const result = service.computeNextBusinessDueDate(sentAt, 3);

      // 3 days later = Thursday January 15, 2026
      expect(result.dueDate.getDay()).toBe(4); // Thursday
      expect(result.wasPostponed).toBe(false);
      expect(result.postponeReason).toBeUndefined();
    });

    it('should postpone Saturday due date to Monday', () => {
      // Wednesday January 14, 2026
      const sentAt = new Date(2026, 0, 14, 10, 0, 0);
      const result = service.computeNextBusinessDueDate(sentAt, 3);

      // 3 days later = Saturday January 17, 2026 -> postponed to Monday January 19
      expect(result.originalDueDate.getDay()).toBe(6); // Saturday
      expect(result.dueDate.getDay()).toBe(1); // Monday
      expect(result.wasPostponed).toBe(true);
      expect(result.postponeReason).toBe('saturday');
    });

    it('should postpone Sunday due date to Monday', () => {
      // Thursday January 15, 2026
      const sentAt = new Date(2026, 0, 15, 10, 0, 0);
      const result = service.computeNextBusinessDueDate(sentAt, 3);

      // 3 days later = Sunday January 18, 2026 -> postponed to Monday January 19
      expect(result.originalDueDate.getDay()).toBe(0); // Sunday
      expect(result.dueDate.getDay()).toBe(1); // Monday
      expect(result.wasPostponed).toBe(true);
      expect(result.postponeReason).toBe('sunday');
    });

    it('should use default SLA days when not specified', () => {
      const sentAt = new Date('2026-01-13T10:00:00Z');
      const result = service.computeNextBusinessDueDate(sentAt);

      // Default is 3 days
      const expectedDate = new Date(sentAt);
      expectedDate.setDate(expectedDate.getDate() + 3);

      expect(result.originalDueDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should set due time to 9 AM', () => {
      const sentAt = new Date('2026-01-13T15:30:00Z');
      const result = service.computeNextBusinessDueDate(sentAt, 1);

      expect(result.dueDate.getHours()).toBe(9);
      expect(result.dueDate.getMinutes()).toBe(0);
    });
  });

  describe('isBusinessDay', () => {
    it('should return true for Monday', () => {
      const monday = new Date(2026, 0, 12, 12, 0, 0); // January 12, 2026 is Monday
      expect(service.isBusinessDay(monday)).toBe(true);
    });

    it('should return true for Friday', () => {
      const friday = new Date(2026, 0, 16, 12, 0, 0); // January 16, 2026 is Friday
      expect(service.isBusinessDay(friday)).toBe(true);
    });

    it('should return false for Saturday', () => {
      const saturday = new Date(2026, 0, 17, 12, 0, 0); // January 17, 2026 is Saturday
      expect(service.isBusinessDay(saturday)).toBe(false);
    });

    it('should return false for Sunday', () => {
      const sunday = new Date(2026, 0, 18, 12, 0, 0); // January 18, 2026 is Sunday
      expect(service.isBusinessDay(sunday)).toBe(false);
    });
  });

  describe('getNextBusinessDay', () => {
    it('should return same day for weekdays', () => {
      const wednesday = new Date(2026, 0, 14, 12, 0, 0); // January 14, 2026 is Wednesday
      const result = service.getNextBusinessDay(wednesday);
      expect(result.getDate()).toBe(14);
    });

    it('should return Monday for Saturday', () => {
      const saturday = new Date(2026, 0, 17, 12, 0, 0); // January 17, 2026 is Saturday
      const result = service.getNextBusinessDay(saturday);
      expect(result.getDay()).toBe(1); // Monday
      expect(result.getDate()).toBe(19); // January 19
    });

    it('should return Monday for Sunday', () => {
      const sunday = new Date(2026, 0, 18, 12, 0, 0); // January 18, 2026 is Sunday
      const result = service.getNextBusinessDay(sunday);
      expect(result.getDay()).toBe(1); // Monday
      expect(result.getDate()).toBe(19); // January 19
    });
  });

  describe('addBusinessDays', () => {
    it('should add business days skipping weekends', () => {
      // Friday January 16, 2026
      const friday = new Date(2026, 0, 16, 12, 0, 0);
      const result = service.addBusinessDays(friday, 3);

      // Skip Sat/Sun, should be Wednesday January 21
      expect(result.getDay()).toBe(3); // Wednesday
      expect(result.getDate()).toBe(21);
    });

    it('should handle starting on weekend', () => {
      const saturday = new Date(2026, 0, 17, 12, 0, 0); // Saturday
      const result = service.addBusinessDays(saturday, 1);

      // Start from Saturday, next day is Sunday (skipped), then Monday (counted as 1)
      expect(result.getDay()).toBe(1); // Monday
    });
  });

  describe('isReminderDue', () => {
    it('should return true when due date is in the past', () => {
      const dueDate = new Date('2026-01-10');
      const now = new Date('2026-01-15');
      expect(service.isReminderDue(dueDate, now)).toBe(true);
    });

    it('should return true when due date is now', () => {
      const now = new Date('2026-01-15T10:00:00Z');
      expect(service.isReminderDue(now, now)).toBe(true);
    });

    it('should return false when due date is in the future', () => {
      const dueDate = new Date('2026-01-20');
      const now = new Date('2026-01-15');
      expect(service.isReminderDue(dueDate, now)).toBe(false);
    });
  });

  describe('getBusinessDaysBetween', () => {
    it('should count only business days', () => {
      // Monday to Friday (same week)
      const monday = new Date(2026, 0, 12, 12, 0, 0); // Jan 12 is Monday
      const friday = new Date(2026, 0, 16, 12, 0, 0); // Jan 16 is Friday

      // Tue, Wed, Thu, Fri = 4 days (Mon is start, not counted)
      expect(service.getBusinessDaysBetween(monday, friday)).toBe(4);
    });

    it('should skip weekends', () => {
      // Friday to next Friday (includes weekend)
      const friday1 = new Date(2026, 0, 16, 12, 0, 0); // Jan 16 is Friday
      const friday2 = new Date(2026, 0, 23, 12, 0, 0); // Jan 23 is Friday

      // Sat(skip), Sun(skip), Mon, Tue, Wed, Thu, Fri = 5 business days
      expect(service.getBusinessDaysBetween(friday1, friday2)).toBe(5);
    });
  });

  describe('getReminderUrgency', () => {
    it('should return normal within SLA', () => {
      const sentAt = new Date('2026-01-13');
      const now = new Date('2026-01-15'); // 2 days later

      expect(service.getReminderUrgency(sentAt, now)).toBe('normal');
    });

    it('should return urgent after SLA but within 2x', () => {
      const sentAt = new Date('2026-01-13');
      const now = new Date('2026-01-20'); // 5 business days later

      expect(service.getReminderUrgency(sentAt, now)).toBe('urgent');
    });

    it('should return critical after 2x SLA', () => {
      const sentAt = new Date('2026-01-13');
      const now = new Date('2026-01-27'); // 10 business days later

      expect(service.getReminderUrgency(sentAt, now)).toBe('critical');
    });
  });

  describe('calculateNextReminderDate', () => {
    it('should increase interval with exponential backoff', () => {
      const lastReminder = new Date('2026-01-13');

      const first = service.calculateNextReminderDate(lastReminder, 0);
      const second = service.calculateNextReminderDate(lastReminder, 1);
      const third = service.calculateNextReminderDate(lastReminder, 2);

      // First: 3 days, Second: 3+2=5 days, Third: 3+4=7 days
      expect(first.originalDueDate.getDate() - lastReminder.getDate()).toBe(3);
      expect(second.originalDueDate.getDate() - lastReminder.getDate()).toBe(5);
      expect(third.originalDueDate.getDate() - lastReminder.getDate()).toBe(7);
    });

    it('should cap additional days at 7', () => {
      const lastReminder = new Date('2026-01-13');
      const result = service.calculateNextReminderDate(lastReminder, 10);

      // Max should be 3 + 7 = 10 days
      expect(result.originalDueDate.getDate() - lastReminder.getDate()).toBe(10);
    });
  });
});
