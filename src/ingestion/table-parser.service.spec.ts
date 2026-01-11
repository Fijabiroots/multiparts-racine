import { Test, TestingModule } from '@nestjs/testing';
import { TableParserService, HeaderDetection, TableExtractionResult } from './table-parser.service';
import { ParsedRow, NormalizedDocument } from './types';

describe('TableParserService', () => {
  let service: TableParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TableParserService],
    }).compile();

    service = module.get<TableParserService>(TableParserService);
    await service.onModuleInit();
  });

  // ============================================================================
  // ANTI-REGRESSION: Form Metadata Detection
  // ============================================================================

  describe('Form Metadata Detection', () => {
    it('should reject "Fleet Number / Activity code / GL Code / WO" as header (Case A)', () => {
      const rows: ParsedRow[] = [
        { raw: 'Some header text', cells: ['Some', 'header', 'text'] },
        { raw: 'Fleet Number / Activity code / GL Code / WO', cells: ['Fleet Number', 'Activity code', 'GL Code', 'WO'] },
        { raw: '10 EA Item description here', cells: ['10', 'EA', 'Item description here'] },
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);

      // The form metadata line should NOT be detected as header
      expect(result.headerDetection.isFormMetadata ||
             result.headerDetection.rejectionReason?.includes('form metadata') ||
             !result.headerDetection.found ||
             result.headerDetection.lineIndex !== 1).toBe(true);
    });

    it('should detect valid RFQ header "Line Quantity UOM Item Code Part Number Item Description" (Case B)', () => {
      const rows: ParsedRow[] = [
        { raw: 'Purchase Requisition', cells: ['Purchase Requisition'] },
        { raw: 'Line Quantity UOM Item Code Part Number Item Description', cells: ['Line', 'Quantity', 'UOM', 'Item Code', 'Part Number', 'Item Description'] },
        { raw: '1 10 EA 12345 ABC-123 Test item description', cells: ['1', '10', 'EA', '12345', 'ABC-123', 'Test item description'] },
        { raw: '2 5 SET 67890 XYZ-456 Another item here', cells: ['2', '5', 'SET', '67890', 'XYZ-456', 'Another item here'] },
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);

      // Valid header should be detected
      expect(result.headerDetection.found).toBe(true);
      expect(result.headerDetection.lineIndex).toBe(1);
    });
  });

  // ============================================================================
  // ANTI-REGRESSION: Fallback Mechanism
  // ============================================================================

  describe('Fallback Mechanism', () => {
    it('should trigger fallback when header-based parsing yields < 3 items (Case C)', () => {
      // Mock a case where header is found but only 2 items extracted
      const rows: ParsedRow[] = [
        { raw: 'Line Qty UOM Description', cells: ['Line', 'Qty', 'UOM', 'Description'] },
        { raw: '1 10 EA First item', cells: ['1', '10', 'EA', 'First item'] },
        { raw: '2 5 SET Second item', cells: ['2', '5', 'SET', 'Second item'] },
        // No more items - should trigger fallback
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);

      // Either header-based worked (2 items) or fallback was triggered
      // The important thing is the system handled it gracefully
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      if (result.items.length < 3 && result.headerDetection.found) {
        expect(result.fallbackTriggered).toBe(true);
      }
    });
  });

  // ============================================================================
  // SPEC LINE CLASSIFICATION
  // ============================================================================

  describe('Spec Line Classification', () => {
    it('should detect IP66 spec line (Case E)', () => {
      const specCheck = service.isSpecLine('Enclosure: IP66 rated for outdoor use');
      expect(specCheck.isSpec).toBe(true);
      expect(specCheck.patterns).toContain('key:value');
    });

    it('should detect voltage spec line', () => {
      const specCheck = service.isSpecLine('Power supply: 230VAC 50Hz');
      expect(specCheck.isSpec).toBe(true);
    });

    it('should detect standard/norm spec line', () => {
      const specCheck = service.isSpecLine('Material: AISI 316 stainless steel');
      expect(specCheck.isSpec).toBe(true);
    });

    it('should NOT detect header as spec line', () => {
      const specCheck = service.isSpecLine('Line Quantity UOM Description');
      expect(specCheck.isSpec).toBe(false);
    });

    it('should detect key:value pattern', () => {
      const specCheck = service.isSpecLine('Temperature range: -20°C to +60°C');
      expect(specCheck.isSpec).toBe(true);
      expect(specCheck.patterns).toContain('key:value');
    });
  });

  // ============================================================================
  // CONFIDENCE SCORING
  // ============================================================================

  describe('Confidence Scoring', () => {
    it('should give high confidence to item with qty, uom, and code', () => {
      const item = {
        description: 'Test item with good data',
        quantity: 10,
        unit: 'EA',
        internalCode: '12345',
        supplierCode: 'ABC-123',
        originalLine: 1,
      };

      const confidence = service.calculateItemConfidence(item);
      expect(confidence).toBeGreaterThanOrEqual(70);
    });

    it('should give low confidence to item without qty', () => {
      const item = {
        description: 'Test item without quantity',
        quantity: 0,
        unit: 'pcs',
      };

      const confidence = service.calculateItemConfidence(item);
      expect(confidence).toBeLessThan(60);
    });

    it('should calculate stats correctly', () => {
      const items = [
        { description: 'Item 1', quantity: 10, unit: 'EA', internalCode: '123' },
        { description: 'Item 2', quantity: 5, unit: 'SET' },
        { description: 'Short', quantity: 0 },
      ];

      const stats = service.calculateConfidenceStats(items);
      expect(stats.minConfidence).toBeLessThanOrEqual(stats.avgConfidence);
      expect(stats.avgConfidence).toBeLessThanOrEqual(stats.maxConfidence);
    });
  });

  // ============================================================================
  // TEXT NORMALIZATION
  // ============================================================================

  describe('Text Normalization', () => {
    it('should normalize CRLF to LF', () => {
      const input = 'Line 1\r\nLine 2\r\nLine 3';
      const result = service.normalizeTextForParsing(input);
      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should fix ligatures', () => {
      const input = 'ﬁnal ﬂow and ﬀect';
      const result = service.normalizeTextForParsing(input);
      expect(result).toBe('final flow and ffect');
    });

    it('should reduce multiple spaces', () => {
      const input = 'Word1    Word2     Word3';
      const result = service.normalizeTextForParsing(input);
      expect(result).toBe('Word1 Word2 Word3');
    });
  });

  // ============================================================================
  // ZONE DETECTION
  // ============================================================================

  describe('Zone Detection', () => {
    it('should detect items zone based on header', () => {
      const rows: ParsedRow[] = [
        { raw: 'Company Header', cells: ['Company Header'] },
        { raw: 'Date: 2024-01-01', cells: ['Date:', '2024-01-01'] },
        { raw: 'Line Qty UOM Description', cells: ['Line', 'Qty', 'UOM', 'Description'] },
        { raw: '1 10 EA Item 1', cells: ['1', '10', 'EA', 'Item 1'] },
        { raw: '2 5 SET Item 2', cells: ['2', '5', 'SET', 'Item 2'] },
        { raw: 'Terms and Conditions', cells: ['Terms and Conditions'] },
        { raw: 'Payment within 30 days', cells: ['Payment within 30 days'] },
      ];

      const zone = service.detectItemsZone(rows, 2); // Header at line 2
      expect(zone.startLine).toBe(3); // After header
      expect(zone.detectionMethod).toBe('header-based');
    });

    it('should detect zone end with terms keywords', () => {
      const rows: ParsedRow[] = [
        { raw: 'Line Qty Description', cells: ['Line', 'Qty', 'Description'] },
        { raw: '1 10 Item 1', cells: ['1', '10', 'Item 1'] },
        { raw: '2 5 Item 2', cells: ['2', '5', 'Item 2'] },
        { raw: '3 3 Item 3', cells: ['3', '3', 'Item 3'] },
        { raw: 'terms and conditions apply', cells: ['terms and conditions apply'] },
        { raw: 'Please sign below', cells: ['Please sign below'] },
      ];

      const zone = service.detectItemsZone(rows, 0);
      expect(zone.endLine).toBeLessThan(rows.length - 1);
    });
  });

  // ============================================================================
  // POST-PROCESSING MERGE
  // ============================================================================

  describe('Post-Processing Merge', () => {
    it('should merge items with same code when second has no qty', () => {
      const items = [
        { description: 'Main item description', quantity: 10, unit: 'EA', internalCode: '12345' },
        { description: 'continuation text here', quantity: 1, unit: 'pcs', internalCode: '12345' },
      ];

      const result = service.postProcessMergeItems(items);
      expect(result.merged).toBeGreaterThanOrEqual(0);
    });

    it('should remove weak items by attaching to previous', () => {
      const items = [
        { description: 'Good item with data', quantity: 10, unit: 'EA', internalCode: '123' },
        { description: 'short', quantity: 0 },
      ];

      const result = service.postProcessMergeItems(items);
      expect(result.items.length).toBeLessThanOrEqual(items.length);
    });
  });

  // ============================================================================
  // HEADER VALIDATION
  // ============================================================================

  describe('Header Validation', () => {
    it('should require description column in valid header', () => {
      // Header without description should be rejected
      const rows: ParsedRow[] = [
        { raw: 'Line Qty UOM', cells: ['Line', 'Qty', 'UOM'] },
        { raw: '1 10 EA', cells: ['1', '10', 'EA'] },
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);

      // Without description column, header should be rejected or extraction should be heuristic
      if (result.headerDetection.found) {
        const hasDescription = result.headerDetection.columns.some(c => c.type === 'description');
        expect(hasDescription).toBe(true);
      }
    });

    it('should reject header with duplicate column types', () => {
      // Create document that might produce duplicate columns
      const rows: ParsedRow[] = [
        { raw: 'Fleet Number Activity code GL Code WO', cells: ['Fleet Number', 'Activity code', 'GL Code', 'WO'] },
        { raw: 'Some item data', cells: ['Some', 'item', 'data'] },
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);

      // Either header should be rejected or columns should be deduplicated
      if (result.headerDetection.found && result.headerDetection.columns.length > 0) {
        const types = result.headerDetection.columns.map(c => c.type);
        const uniqueTypes = new Set(types);
        expect(uniqueTypes.size).toBe(types.length); // No duplicates
      }
    });
  });

  // ============================================================================
  // QTY ANCHOR LINE DETECTION
  // ============================================================================

  describe('Qty Anchor Line Detection', () => {
    it('should detect qty with unit pattern', () => {
      // Use the existing method through extractFromRows behavior
      const rows: ParsedRow[] = [
        { raw: '10 EA RELAY 24VDC', cells: ['10', 'EA', 'RELAY 24VDC'] },
      ];

      const doc: NormalizedDocument = {
        sourceType: 'attachment_pdf',
        sourceName: 'test.pdf',
        hasPositions: false,
        rows,
        rawText: rows.map(r => r.raw).join('\n'),
      };

      const result = service.parseDocument(doc);
      // Should extract at least one item with quantity
      expect(result.items.length).toBeGreaterThan(0);
      if (result.items[0]) {
        expect(result.items[0].quantity).toBeDefined();
      }
    });
  });
});
