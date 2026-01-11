import { Test, TestingModule } from '@nestjs/testing';
import { DetectorService, DetectionResult } from './detector.service';
import { DatabaseService } from '../database/database.service';
import { ParsedEmail } from '../common/interfaces';

describe('DetectorService', () => {
  let service: DetectorService;
  let mockDatabaseService: Partial<DatabaseService>;

  const createEmail = (overrides: Partial<ParsedEmail> = {}): ParsedEmail => ({
    id: 'test-id',
    messageId: 'test-message-id',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Subject',
    body: 'Test body content',
    date: new Date(),
    attachments: [],
    ...overrides,
  });

  const createAttachment = (filename: string, contentType: string) => ({
    filename,
    contentType,
    content: Buffer.from(''),
    size: 1024,
  });

  beforeEach(async () => {
    mockDatabaseService = {
      getDetectionKeywords: jest.fn().mockResolvedValue([
        { id: '1', keyword: 'demande de prix', weight: 10, language: 'fr', type: 'both' },
        { id: '2', keyword: 'demande de cotation', weight: 10, language: 'fr', type: 'both' },
        { id: '3', keyword: 'RFQ', weight: 10, language: 'both', type: 'both' },
        { id: '4', keyword: 'devis', weight: 8, language: 'fr', type: 'both' },
        { id: '5', keyword: 'cotation', weight: 8, language: 'fr', type: 'both' },
        { id: '6', keyword: 'offre de prix', weight: 9, language: 'fr', type: 'both' },
        { id: '7', keyword: 'request for quotation', weight: 10, language: 'en', type: 'both' },
        { id: '8', keyword: 'price request', weight: 9, language: 'en', type: 'both' },
        { id: '9', keyword: 'quote request', weight: 8, language: 'en', type: 'both' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DetectorService,
        { provide: DatabaseService, useValue: mockDatabaseService },
      ],
    }).compile();

    service = module.get<DetectorService>(DetectorService);
    await service.onModuleInit();
  });

  describe('Explicit RFQ Patterns (Fast-Path)', () => {
    it('should detect "RFQ" alone in subject with 95% confidence', async () => {
      const email = createEmail({ subject: 'RFQ - Steel pipes' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
      expect(result.reason).toContain('Demande de prix explicite');
    });

    it('should detect "RFQ FOR" pattern in subject', async () => {
      const email = createEmail({ subject: 'RFQ for industrial valves' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "RFQ PR-xxx" pattern in subject', async () => {
      const email = createEmail({ subject: 'RFQ PR-12345 Urgent' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Request for Quotation" in subject', async () => {
      const email = createEmail({ subject: 'Request for Quotation - Pumps' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Demande de prix" in subject', async () => {
      const email = createEmail({ subject: 'Demande de prix pour vannes' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Demande de cotation" in subject', async () => {
      const email = createEmail({ subject: 'Demande de cotation urgente' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Demande de devis" in subject', async () => {
      const email = createEmail({ subject: 'Demande de devis équipements' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Appel d\'offres" in subject', async () => {
      const email = createEmail({ subject: "Appel d'offres projet 2024" });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Please quote" pattern in body', async () => {
      const email = createEmail({
        subject: 'Information request',
        body: 'Dear Sir, Please quote your best price for the following items.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });

    it('should detect "Kindly send your quotation" pattern in body', async () => {
      const email = createEmail({
        subject: 'Inquiry',
        body: 'Kindly send your best quotation for the equipment listed below.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBe(95);
    });
  });

  describe('Purchase Order Exclusion', () => {
    it('should exclude emails with "Purchase Order" in subject', async () => {
      const email = createEmail({ subject: 'Purchase Order #12345' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.reason).toContain('Exclu');
    });

    it('should exclude emails with "Bon de commande" in subject', async () => {
      const email = createEmail({ subject: 'Bon de commande N°456' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.reason).toContain('Exclu');
    });

    it('should exclude emails with "PO #xxx" in subject', async () => {
      const email = createEmail({ subject: 'PO #78901 - Confirmation' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.reason).toContain('Exclu');
    });

    it('should exclude emails with "Order confirmation" in body', async () => {
      const email = createEmail({
        subject: 'Your order',
        body: 'This is your order confirmation for the items below.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.reason).toContain('Exclu');
    });

    it('should exclude emails with "Commande N°xxx" pattern', async () => {
      const email = createEmail({
        subject: 'Suivi',
        body: 'Concernant notre commande n°12345, merci de confirmer.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.reason).toContain('Exclu');
    });
  });

  describe('Confidence Calculation (Non Fast-Path)', () => {
    it('should calculate confidence based on fixed threshold', async () => {
      // Email avec "devis" dans le corps (pas de fast-path car pas un pattern explicite)
      const email = createEmail({
        subject: 'Question technique',
        body: 'Pourriez-vous nous envoyer un devis pour ces articles?',
      });
      const result = await service.analyzeEmail(email);

      // "devis" = 8 points → 8/30 * 100 = 27%
      expect(result.confidence).toBeGreaterThanOrEqual(25);
      expect(result.confidence).toBeLessThanOrEqual(30);
    });

    it('should give higher confidence for subject matches', async () => {
      // "cotation" dans le sujet = 8 * 1.5 = 12 points → 40%
      const email = createEmail({
        subject: 'Cotation matériel',
        body: 'Veuillez trouver ci-joint notre demande.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.confidence).toBeGreaterThanOrEqual(38);
      expect(result.confidence).toBeLessThanOrEqual(45);
    });

    it('should add bonus for relevant attachments', async () => {
      const email = createEmail({
        subject: 'Question technique',
        body: 'Voici notre demande avec devis en pièce jointe.',
        attachments: [createAttachment('request.pdf', 'application/pdf')],
      });
      const result = await service.analyzeEmail(email);

      // "devis" = 8 points + attachment = 10 points = 18 points → 60%
      expect(result.confidence).toBeGreaterThanOrEqual(55);
      expect(result.hasRelevantAttachments).toBe(true);
      expect(result.attachmentTypes).toContain('.pdf');
    });

    it('should accumulate points from multiple keywords', async () => {
      const email = createEmail({
        subject: 'Question',
        body: 'Nous avons besoin d\'un devis et d\'une cotation pour ce projet.',
      });
      const result = await service.analyzeEmail(email);

      // "devis" (8) + "cotation" (8) = 16 points → 53%
      expect(result.confidence).toBeGreaterThanOrEqual(50);
    });

    it('should detect as price request when confidence >= 40%', async () => {
      const email = createEmail({
        subject: 'Cotation urgente',  // 8 * 1.5 = 12 points → 40%
        body: 'Merci de nous répondre rapidement.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(40);
    });

    it('should not detect as price request when confidence < 40%', async () => {
      const email = createEmail({
        subject: 'Question générale',
        body: 'Bonjour, nous avons une question concernant vos produits.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(false);
      expect(result.confidence).toBeLessThan(40);
    });
  });

  describe('Attachment Handling', () => {
    it('should identify PDF attachments as relevant', async () => {
      const email = createEmail({
        subject: 'RFQ',
        attachments: [createAttachment('request.pdf', 'application/pdf')],
      });
      const result = await service.analyzeEmail(email);

      expect(result.hasRelevantAttachments).toBe(true);
      expect(result.attachmentTypes).toContain('.pdf');
    });

    it('should identify Excel attachments as relevant', async () => {
      const email = createEmail({
        subject: 'RFQ',
        attachments: [createAttachment('items.xlsx', 'application/xlsx')],
      });
      const result = await service.analyzeEmail(email);

      expect(result.hasRelevantAttachments).toBe(true);
      expect(result.attachmentTypes).toContain('.xlsx');
    });

    it('should identify Word attachments as relevant', async () => {
      const email = createEmail({
        subject: 'RFQ',
        attachments: [createAttachment('spec.docx', 'application/docx')],
      });
      const result = await service.analyzeEmail(email);

      expect(result.hasRelevantAttachments).toBe(true);
      expect(result.attachmentTypes).toContain('.docx');
    });

    it('should not consider image attachments as relevant', async () => {
      const email = createEmail({
        subject: 'Question générale',
        body: 'Voici une photo.',
        attachments: [createAttachment('photo.jpg', 'image/jpeg')],
      });
      const result = await service.analyzeEmail(email);

      expect(result.hasRelevantAttachments).toBe(false);
    });
  });

  describe('Keyword Matching', () => {
    it('should match keywords case-insensitively', async () => {
      const email = createEmail({ subject: 'RFQ test' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
    });

    it('should match "rfq" in lowercase', async () => {
      const email = createEmail({ subject: 'rfq for parts' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
    });

    it('should record matched keywords in result', async () => {
      const email = createEmail({
        subject: 'Question',
        body: 'Nous cherchons un devis et une cotation.',
      });
      const result = await service.analyzeEmail(email);

      expect(result.matchedKeywords.length).toBeGreaterThanOrEqual(2);
      expect(result.matchedKeywords.some(k => k.keyword === 'devis')).toBe(true);
      expect(result.matchedKeywords.some(k => k.keyword === 'cotation')).toBe(true);
    });
  });

  describe('Batch Processing', () => {
    it('should analyze multiple emails', async () => {
      const emails = [
        createEmail({ subject: 'RFQ for valves' }),
        createEmail({ subject: 'General inquiry' }),
        createEmail({ subject: 'Purchase Order #123' }),
      ];

      const results = await service.analyzeEmails(emails);

      expect(results.length).toBe(3);
      expect(results[0].detection.isPriceRequest).toBe(true);
      expect(results[1].detection.isPriceRequest).toBe(false);
      expect(results[2].detection.isPriceRequest).toBe(false);
    });

    it('should filter only price request emails', async () => {
      const emails = [
        createEmail({ subject: 'RFQ for valves' }),
        createEmail({ subject: 'General inquiry' }),
        createEmail({ subject: 'Demande de prix urgente' }),
      ];

      const filtered = await service.filterPriceRequestEmails(emails);

      expect(filtered.length).toBe(2);
      expect(filtered[0].subject).toBe('RFQ for valves');
      expect(filtered[1].subject).toBe('Demande de prix urgente');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty subject', async () => {
      const email = createEmail({ subject: '', body: 'Please quote for items.' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
    });

    it('should handle empty body', async () => {
      const email = createEmail({ subject: 'RFQ', body: '' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
    });

    it('should handle email with no attachments', async () => {
      const email = createEmail({ subject: 'RFQ', attachments: [] });
      const result = await service.analyzeEmail(email);

      expect(result.hasRelevantAttachments).toBe(false);
    });

    it('should handle special characters in subject', async () => {
      const email = createEmail({ subject: 'RFQ: équipements & matériaux' });
      const result = await service.analyzeEmail(email);

      expect(result.isPriceRequest).toBe(true);
    });

    it('should handle very long body without timeout', async () => {
      const longBody = 'Lorem ipsum '.repeat(10000) + 'devis';
      const email = createEmail({ subject: 'Question', body: longBody });

      const start = Date.now();
      const result = await service.analyzeEmail(email);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
      expect(result.matchedKeywords.some(k => k.keyword === 'devis')).toBe(true);
    });
  });
});
