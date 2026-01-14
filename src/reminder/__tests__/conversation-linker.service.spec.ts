import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConversationLinkerService } from '../services/conversation-linker.service';
import { DatabaseService } from '../../database/database.service';

describe('ConversationLinkerService', () => {
  let service: ConversationLinkerService;
  let databaseService: Partial<DatabaseService>;

  beforeEach(async () => {
    databaseService = {
      getRfqMappingByMessageId: jest.fn(),
      getRfqMappingByInternalRfq: jest.fn(),
      getRfqMappingByClientRfq: jest.fn(),
      findRfqBySubjectAndSender: jest.fn(),
      getClientById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationLinkerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
      ],
    }).compile();

    service = module.get<ConversationLinkerService>(ConversationLinkerService);
  });

  describe('normalizeSubject', () => {
    it('should remove RE: prefix', () => {
      expect(service.normalizeSubject('RE: Test Subject')).toBe('test subject');
    });

    it('should remove multiple RE: prefixes', () => {
      expect(service.normalizeSubject('Re: RE: re: Test')).toBe('test');
    });

    it('should remove FW: and FWD: prefixes', () => {
      expect(service.normalizeSubject('FW: Fwd: Test')).toBe('test');
    });

    it('should remove TR: prefix (French)', () => {
      expect(service.normalizeSubject('TR: Test')).toBe('test');
    });

    it('should handle mixed prefixes', () => {
      expect(service.normalizeSubject('Re: Fw: TR: Test Message')).toBe('test message');
    });

    it('should collapse whitespace', () => {
      expect(service.normalizeSubject('  Test   Subject  ')).toBe('test subject');
    });

    it('should remove leading/trailing punctuation', () => {
      expect(service.normalizeSubject('...Test Subject!!!')).toBe('test subject');
    });

    it('should handle empty string', () => {
      expect(service.normalizeSubject('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(service.normalizeSubject(null as any)).toBe('');
      expect(service.normalizeSubject(undefined as any)).toBe('');
    });
  });

  describe('extractRfqTokens', () => {
    it('should extract DDP format tokens', () => {
      const tokens = service.extractRfqTokens('Reference: DDP-20260114-001');
      expect(tokens).toContain('DDP-20260114-001');
    });

    it('should extract RFQ format tokens', () => {
      const tokens = service.extractRfqTokens('RFQ-2026-12345 quotation');
      expect(tokens).toContain('RFQ-2026-12345');
    });

    it('should extract PR format tokens', () => {
      const tokens = service.extractRfqTokens('Please quote PR 12345678');
      expect(tokens).toContain('PR 12345678');
    });

    it('should extract multiple tokens', () => {
      const text = 'DDP-20260114-001 and RFQ-2026-123';
      const tokens = service.extractRfqTokens(text);
      expect(tokens.length).toBeGreaterThanOrEqual(2);
    });

    it('should deduplicate tokens', () => {
      const text = 'DDP-20260114-001 mentioned twice DDP-20260114-001';
      const tokens = service.extractRfqTokens(text);
      expect(tokens.filter(t => t === 'DDP-20260114-001').length).toBe(1);
    });

    it('should handle empty text', () => {
      expect(service.extractRfqTokens('')).toEqual([]);
    });
  });

  describe('extractEmail', () => {
    it('should extract email from "Name <email>" format', () => {
      expect(service.extractEmail('John Doe <john@example.com>')).toBe('john@example.com');
    });

    it('should handle plain email', () => {
      expect(service.extractEmail('john@example.com')).toBe('john@example.com');
    });

    it('should lowercase email', () => {
      expect(service.extractEmail('JOHN@EXAMPLE.COM')).toBe('john@example.com');
    });

    it('should handle empty string', () => {
      expect(service.extractEmail('')).toBe('');
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from email', () => {
      expect(service.extractDomain('user@example.com')).toBe('example.com');
    });

    it('should lowercase domain', () => {
      expect(service.extractDomain('user@EXAMPLE.COM')).toBe('example.com');
    });

    it('should handle invalid email', () => {
      expect(service.extractDomain('invalid')).toBe('');
    });
  });

  describe('resolveSentDateForRfq', () => {
    it('should find sent email by RFQ token in subject', async () => {
      const sentEmails = [
        {
          messageId: '<msg1@example.com>',
          subject: 'Demande de Prix DDP-20260114-001',
          body: 'Body text',
          date: new Date('2026-01-14T10:00:00Z'),
        },
      ];

      const result = await service.resolveSentDateForRfq('DDP-20260114-001', sentEmails);

      expect(result.found).toBe(true);
      expect(result.sentAt).toEqual(new Date('2026-01-14T10:00:00Z'));
      expect(result.messageId).toBe('<msg1@example.com>');
      expect(result.matchMethod).toBe('rfq_token_subject');
    });

    it('should find sent email by RFQ token in body', async () => {
      const sentEmails = [
        {
          messageId: '<msg1@example.com>',
          subject: 'Demande de Prix',
          body: 'Please quote reference DDP-20260114-001',
          date: new Date('2026-01-14T10:00:00Z'),
        },
      ];

      const result = await service.resolveSentDateForRfq('DDP-20260114-001', sentEmails);

      expect(result.found).toBe(true);
      expect(result.matchMethod).toBe('rfq_token_body');
    });

    it('should return NOT_FOUND when no match', async () => {
      const sentEmails = [
        {
          messageId: '<msg1@example.com>',
          subject: 'Other Subject',
          body: 'Other body',
          date: new Date(),
        },
      ];

      const result = await service.resolveSentDateForRfq('DDP-20260114-001', sentEmails);

      expect(result.found).toBe(false);
    });

    it('should handle empty sent emails array', async () => {
      const result = await service.resolveSentDateForRfq('DDP-20260114-001', []);

      expect(result.found).toBe(false);
    });

    it('should use stored message ID from database if available', async () => {
      (databaseService.getRfqMappingByInternalRfq as jest.Mock).mockResolvedValue({
        id: 'rfq-123',
        internalRfqNumber: 'DDP-20260114-001',
        messageId: '<stored@example.com>',
      });

      const sentEmails = [
        {
          messageId: '<stored@example.com>',
          subject: 'Test',
          body: 'Test',
          date: new Date('2026-01-14T10:00:00Z'),
          threadId: 'thread-123',
        },
      ];

      const result = await service.resolveSentDateForRfq('DDP-20260114-001', sentEmails);

      expect(result.found).toBe(true);
      expect(result.matchMethod).toBe('message_id');
      expect(result.threadId).toBe('thread-123');
    });
  });

  describe('matchInboundCustomerEmailToRequest', () => {
    it('should match by In-Reply-To header', async () => {
      const mockMapping = {
        id: 'rfq-123',
        internalRfqNumber: 'DDP-20260114-001',
        status: 'sent',
      };

      (databaseService.getRfqMappingByMessageId as jest.Mock).mockResolvedValue(mockMapping);
      (databaseService.getClientById as jest.Mock).mockResolvedValue({
        email: 'customer@example.com',
      });

      const email = {
        id: 'email-1',
        messageId: '<reply@example.com>',
        from: 'customer@example.com',
        to: ['multiparts@multipartsci.com'],
        subject: 'Re: Demande de Prix',
        bodyText: 'Here is our response',
        date: new Date(),
        headers: {},
        inReplyTo: '<original@multiparts.com>',
      };

      const result = await service.matchInboundCustomerEmailToRequest(email);

      expect(result.linked).toBe(true);
      expect(result.matchMethod).toBe('in_reply_to');
      expect(result.confidence).toBe(95);
    });

    it('should match by RFQ token when no thread headers', async () => {
      const mockMapping = {
        id: 'rfq-123',
        internalRfqNumber: 'DDP-20260114-001',
        status: 'sent',
      };

      (databaseService.getRfqMappingByInternalRfq as jest.Mock).mockResolvedValue(mockMapping);
      (databaseService.getClientById as jest.Mock).mockResolvedValue({
        email: 'customer@example.com',
      });

      const email = {
        id: 'email-1',
        messageId: '<new@example.com>',
        from: 'customer@example.com',
        to: ['multiparts@multipartsci.com'],
        subject: 'Quote for DDP-20260114-001',
        bodyText: 'Here is our quote',
        date: new Date(),
        headers: {},
      };

      const result = await service.matchInboundCustomerEmailToRequest(email);

      expect(result.linked).toBe(true);
      expect(result.matchMethod).toBe('rfq_token');
      expect(result.confidence).toBe(85);
    });

    it('should return NOT_LINKED when no match found', async () => {
      (databaseService.getRfqMappingByMessageId as jest.Mock).mockResolvedValue(null);
      (databaseService.getRfqMappingByInternalRfq as jest.Mock).mockResolvedValue(null);
      (databaseService.getRfqMappingByClientRfq as jest.Mock).mockResolvedValue(null);
      (databaseService.findRfqBySubjectAndSender as jest.Mock).mockResolvedValue(null);

      const email = {
        id: 'email-1',
        messageId: '<new@example.com>',
        from: 'unknown@example.com',
        to: ['multiparts@multipartsci.com'],
        subject: 'Random email',
        bodyText: 'Some content',
        date: new Date(),
        headers: {},
      };

      const result = await service.matchInboundCustomerEmailToRequest(email);

      expect(result.linked).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });
});
