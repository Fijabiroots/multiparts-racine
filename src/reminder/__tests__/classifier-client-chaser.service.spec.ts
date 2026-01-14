import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClassifierClientChaserService } from '../services/classifier-client-chaser.service';
import { ConversationLinkerService } from '../services/conversation-linker.service';
import { InboundEmail, RequestContext } from '../interfaces/reminder.interfaces';

describe('ClassifierClientChaserService', () => {
  let service: ClassifierClientChaserService;
  let linkerService: Partial<ConversationLinkerService>;

  const createEmail = (overrides: Partial<InboundEmail> = {}): InboundEmail => ({
    id: 'test-id',
    messageId: '<test@test.com>',
    from: 'customer@example.com',
    to: ['multiparts@multipartsci.com'],
    subject: 'Test Subject',
    bodyText: 'Test body',
    date: new Date(),
    headers: {},
    ...overrides,
  });

  const createContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
    requestId: 'req-123',
    internalRfqNumber: 'DDP-20260114-001',
    customerEmail: 'customer@example.com',
    customerDomain: 'example.com',
    status: 'IN_PROGRESS',
    createdAt: new Date(),
    autoReplyCount: 0,
    ...overrides,
  });

  beforeEach(async () => {
    linkerService = {
      normalizeSubject: jest.fn((subject: string) => subject.toLowerCase().replace(/^re:\s*/i, '')),
      extractEmail: jest.fn((from: string) => from.toLowerCase()),
      extractDomain: jest.fn((email: string) => email.split('@')[1] || ''),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassifierClientChaserService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'reminder.chaserScoreThreshold') return 60;
              if (key === 'reminder.closedStatuses') return ['CLOSED', 'CANCELLED', 'LOST', 'WON'];
              return undefined;
            }),
          },
        },
        {
          provide: ConversationLinkerService,
          useValue: linkerService,
        },
      ],
    }).compile();

    service = module.get<ClassifierClientChaserService>(ClassifierClientChaserService);
  });

  describe('Guard Rails', () => {
    it('should block internal sender (multipartsci.com)', async () => {
      const email = createEmail({ from: 'user@multipartsci.com' });
      const result = await service.classify(email);

      expect(result.decision).toBe('BLOCKED_INTERNAL');
      expect(result.score).toBe(0);
    });

    it('should block auto-reply headers (X-Multiparts-Auto)', async () => {
      const email = createEmail({
        headers: { 'X-Multiparts-Auto': '1' },
      });
      const result = await service.classify(email);

      expect(result.decision).toBe('BLOCKED_AUTO_REPLY');
    });

    it('should block auto-reply headers (Auto-Submitted)', async () => {
      const email = createEmail({
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
      const result = await service.classify(email);

      expect(result.decision).toBe('BLOCKED_AUTO_REPLY');
    });

    it('should block closed status requests', async () => {
      const email = createEmail();
      const context = createContext({ status: 'CLOSED' });
      const result = await service.classify(email, context);

      expect(result.decision).toBe('BLOCKED_CLOSED_STATUS');
    });
  });

  describe('Positive Chaser Detection', () => {
    it('should detect "Relance" in subject', async () => {
      const email = createEmail({ subject: 'Relance: Demande de prix' });
      const result = await service.classify(email);

      expect(result.score).toBeGreaterThanOrEqual(35);
      expect(result.triggeredRules.some(r => r.rule === 'subject_strong')).toBe(true);
    });

    it('should detect "Follow up" in subject', async () => {
      const email = createEmail({ subject: 'Follow up on our request' });
      const result = await service.classify(email);

      expect(result.score).toBeGreaterThanOrEqual(35);
    });

    it('should detect "Any update?" in body', async () => {
      const email = createEmail({
        subject: 'Re: Our request',
        bodyText: 'Hello, just following up on our request. Any news?',
      });
      const result = await service.classify(email);

      // "just following up" should trigger body_strong (+35)
      expect(result.score).toBeGreaterThanOrEqual(35);
    });

    it('should detect French chaser phrases in body', async () => {
      const email = createEmail({
        bodyText: 'Bonjour, je me permets de relancer concernant notre demande.',
      });
      const result = await service.classify(email);

      expect(result.score).toBeGreaterThanOrEqual(35);
      expect(result.triggeredRules.some(r => r.rule === 'body_strong')).toBe(true);
    });

    it('should add context bonus for thread-linked emails', async () => {
      const email = createEmail({
        subject: 'Re: Request',
        bodyText: 'Any news?',
        threadId: 'thread-123',
        inReplyTo: '<original@multiparts.com>',
      });
      const context = createContext();
      const result = await service.classify(email, context);

      // Should get +15 for thread and +15 for inReplyTo
      expect(result.triggeredRules.some(r => r.rule === 'context_thread_linked')).toBe(true);
      expect(result.triggeredRules.some(r => r.rule === 'context_reply_linked')).toBe(true);
    });

    it('should classify as CHASER with score >= 60', async () => {
      const email = createEmail({
        subject: 'Relance: DDP-20260114-001',
        bodyText: 'Bonjour, avez-vous des nouvelles concernant notre demande?',
      });
      const result = await service.classify(email);

      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.decision).toBe('CHASER');
    });
  });

  describe('Negative Cases (Anti-False Positives)', () => {
    it('should NOT classify as chaser when only "urgent" in subject', async () => {
      const email = createEmail({
        subject: 'Urgent request',
        bodyText: 'Please process this request.',
      });
      const result = await service.classify(email);

      // "urgent" alone gives +10, not enough for 60
      expect(result.score).toBeLessThan(60);
      expect(result.decision).toBe('NOT_CHASER');
    });

    it('should deduct points for purchase order content', async () => {
      const email = createEmail({
        subject: 'Follow up',
        bodyText: 'Here is our purchase order PO-12345',
      });
      const result = await service.classify(email);

      expect(result.triggeredRules.some(r => r.rule === 'purchase_order')).toBe(true);
      expect(result.triggeredRules.find(r => r.rule === 'purchase_order')?.points).toBe(-40);
    });

    it('should deduct points for delivery/logistics content', async () => {
      const email = createEmail({
        subject: 'Follow up on delivery',
        bodyText: 'We need the tracking number for our shipment.',
      });
      const result = await service.classify(email);

      expect(result.triggeredRules.some(r => r.rule === 'delivery_indicators')).toBe(true);
    });

    it('should deduct points for cancellation content', async () => {
      const email = createEmail({
        subject: 'Re: Request',
        bodyText: 'We would like to cancel this request.',
      });
      const result = await service.classify(email);

      expect(result.triggeredRules.some(r => r.rule === 'cancellation_indicators')).toBe(true);
    });

    it('should not be confused by new RFQ request', async () => {
      const email = createEmail({
        subject: 'New RFQ Request',
        bodyText: 'Please quote the following items. Attached please find our requirements.',
      });
      const result = await service.classify(email);

      expect(result.triggeredRules.some(r => r.rule === 'new_request_indicators')).toBe(true);
    });
  });

  describe('Borderline Cases', () => {
    it('should handle empty subject and body', async () => {
      const email = createEmail({
        subject: '',
        bodyText: '',
      });
      const result = await service.classify(email);

      expect(result.score).toBe(0);
      expect(result.decision).toBe('NOT_CHASER');
    });

    it('should handle mixed signals (chaser + PO)', async () => {
      const email = createEmail({
        subject: 'Relance',
        bodyText: 'Concernant notre bon de commande 12345, merci de nous donner un retour.',
      });
      const result = await service.classify(email);

      // Subject: +35, Body strong: +35, PO: -40 = 30
      // Should be under threshold
      expect(result.decision).toBe('NOT_CHASER');
    });
  });

  describe('determineRequestState', () => {
    it('should return NEVER_TREATED when no context', () => {
      const result = service.determineRequestState(undefined);
      expect(result).toBe('NEVER_TREATED');
    });

    it('should return NEVER_TREATED for DRAFT status', () => {
      const context = createContext({ status: 'DRAFT' });
      const result = service.determineRequestState(context);
      expect(result).toBe('NEVER_TREATED');
    });

    it('should return NEVER_TREATED for NEW status', () => {
      const context = createContext({ status: 'NEW' });
      const result = service.determineRequestState(context);
      expect(result).toBe('NEVER_TREATED');
    });

    it('should return TREATED when sentAt exists', () => {
      const context = createContext({
        status: 'IN_PROGRESS',
        sentAt: new Date(),
      });
      const result = service.determineRequestState(context);
      expect(result).toBe('TREATED');
    });

    it('should return IN_PROGRESS for appropriate statuses', () => {
      const context = createContext({ status: 'AWAITING_SUPPLIER' });
      const result = service.determineRequestState(context);
      expect(result).toBe('IN_PROGRESS');
    });
  });
});
