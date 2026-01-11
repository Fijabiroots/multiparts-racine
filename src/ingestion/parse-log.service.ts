import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ParseLog,
  SourceRecord,
  InputType,
  ColumnType,
  DetectedColumn,
  FilteredImage,
} from './types';
import { HeaderDetection, TableExtractionResult } from './table-parser.service';

/**
 * Parse Log Builder - Accumulates data during parsing
 */
export class ParseLogBuilder {
  private readonly startTime: number;
  private requestId: string;
  private sources: SourceRecord[] = [];
  private detectedInputTypes: Set<InputType> = new Set();
  private headerDetection?: HeaderDetection;
  private filteredImages: FilteredImage[] = [];
  private processedImages: string[] = [];
  private ocrUsedPages: number[] = [];
  private ocrMethod?: 'tesseract' | 'pdfjs';
  private warnings: string[] = [];
  private errors: string[] = [];
  private lineCount = 0;
  private extractionMethod = '';
  private mergedContinuationLines = 0;
  private extractionPath?: 'pdfjs_layout' | 'pdf-parse' | 'ocr' | 'mixed';
  private layoutStats?: {
    totalPages: number;
    totalTokens: number;
    totalRows: number;
    avgCellsPerRow: number;
    medianGapX: number;
  };
  private unknownBrandCandidates: string[] = [];

  constructor(requestId: string) {
    this.requestId = requestId;
    this.startTime = Date.now();
  }

  /**
   * Add a source record
   */
  addSource(source: SourceRecord): this {
    this.sources.push(source);

    // Infer input type from source
    const type = source.type;
    if (type.includes('pdf')) this.detectedInputTypes.add('pdf');
    else if (type.includes('excel')) this.detectedInputTypes.add('xlsx');
    else if (type.includes('word')) this.detectedInputTypes.add('docx');
    else if (type.includes('image')) this.detectedInputTypes.add('image');
    else if (type.includes('email')) this.detectedInputTypes.add('email_text');

    return this;
  }

  /**
   * Set header detection result
   */
  setHeaderDetection(detection: HeaderDetection): this {
    this.headerDetection = detection;
    return this;
  }

  /**
   * Add filtered images
   */
  addFilteredImages(images: FilteredImage[]): this {
    this.filteredImages.push(...images);
    return this;
  }

  /**
   * Add processed image names
   */
  addProcessedImages(names: string[]): this {
    this.processedImages.push(...names);
    return this;
  }

  /**
   * Record OCR usage
   */
  setOcrUsed(pages: number[], method: 'tesseract' | 'pdfjs'): this {
    this.ocrUsedPages = pages;
    this.ocrMethod = method;
    return this;
  }

  /**
   * Add a warning
   */
  addWarning(warning: string): this {
    this.warnings.push(warning);
    return this;
  }

  /**
   * Add an error
   */
  addError(error: string): this {
    this.errors.push(error);
    return this;
  }

  /**
   * Set the final line count
   */
  setLineCount(count: number): this {
    this.lineCount = count;
    return this;
  }

  /**
   * Set extraction method
   */
  setExtractionMethod(method: string): this {
    this.extractionMethod = method;
    return this;
  }

  /**
   * Apply table extraction result
   */
  applyExtractionResult(result: TableExtractionResult): this {
    this.headerDetection = result.headerDetection;
    this.lineCount = result.items.length;
    this.warnings.push(...result.warnings);
    this.extractionMethod = result.extractionMethod;
    if (result.mergedContinuationLines !== undefined) {
      this.mergedContinuationLines = result.mergedContinuationLines;
    }
    return this;
  }

  /**
   * Set merged continuation lines count
   */
  setMergedContinuationLines(count: number): this {
    this.mergedContinuationLines = count;
    return this;
  }

  /**
   * Set extraction path
   */
  setExtractionPath(path: 'pdfjs_layout' | 'pdf-parse' | 'ocr' | 'mixed'): this {
    this.extractionPath = path;
    return this;
  }

  /**
   * Set layout stats
   */
  setLayoutStats(stats: { totalPages: number; totalTokens: number; totalRows: number; avgCellsPerRow: number; medianGapX: number }): this {
    this.layoutStats = stats;
    return this;
  }

  /**
   * Add unknown brand candidate
   */
  addUnknownBrandCandidate(brand: string): this {
    if (!this.unknownBrandCandidates.includes(brand)) {
      this.unknownBrandCandidates.push(brand);
    }
    return this;
  }

  /**
   * Build the final ParseLog object
   */
  build(): ParseLog {
    const processingTimeMs = Date.now() - this.startTime;

    return {
      requestId: this.requestId,
      timestamp: new Date(),
      sources: this.sources,
      detectedInputTypes: Array.from(this.detectedInputTypes),
      headerDetected: this.headerDetection?.found ?? false,
      headerScore: this.headerDetection?.score ?? 0,
      headerPage: undefined, // Simplified: page tracking removed
      headerLineIndex: this.headerDetection?.lineIndex,
      detectedColumns: (this.headerDetection?.columns ?? [])
        .filter((c) => c.type !== 'unknown')
        .map((c) => c.type),
      columnDetails: this.headerDetection?.columns ?? [],
      ocrUsed: this.ocrUsedPages.length > 0,
      ocrUsedPages: this.ocrUsedPages,
      ocrMethod: this.ocrMethod,
      filteredImages: this.filteredImages,
      processedImages: this.processedImages,
      lineCount: this.lineCount,
      warnings: this.warnings,
      errors: this.errors,
      mergedContinuationLines: this.mergedContinuationLines,
      extractionPath: this.extractionPath,
      layoutStats: this.layoutStats,
      unknownBrandCandidates: this.unknownBrandCandidates.length > 0 ? this.unknownBrandCandidates : undefined,
      processingTimeMs,
      extractionMethod: this.extractionMethod,
    };
  }
}

/**
 * Parse Log Service
 *
 * Manages creation and persistence of parse logs for audit purposes.
 */
@Injectable()
export class ParseLogService {
  private readonly logger = new Logger(ParseLogService.name);
  private readonly outputDir: string;

  constructor() {
    this.outputDir = process.env.OUTPUT_DIR || './output';
    this.ensureOutputDir();
  }

  /**
   * Create a new parse log builder
   */
  createBuilder(requestId: string): ParseLogBuilder {
    return new ParseLogBuilder(requestId);
  }

  /**
   * Save a parse log to file
   */
  async saveLog(log: ParseLog): Promise<string> {
    const filename = `${log.requestId}.parse-log.json`;
    const filepath = path.join(this.outputDir, filename);

    try {
      const json = JSON.stringify(log, null, 2);
      await fs.promises.writeFile(filepath, json, 'utf-8');

      this.logger.log(`Parse log saved: ${filename}`);
      return filepath;
    } catch (error) {
      this.logger.error(`Failed to save parse log: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load a parse log from file
   */
  async loadLog(requestId: string): Promise<ParseLog | null> {
    const filename = `${requestId}.parse-log.json`;
    const filepath = path.join(this.outputDir, filename);

    try {
      if (!fs.existsSync(filepath)) {
        return null;
      }

      const json = await fs.promises.readFile(filepath, 'utf-8');
      return JSON.parse(json) as ParseLog;
    } catch (error) {
      this.logger.error(`Failed to load parse log: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate a summary of the parse log
   */
  generateSummary(log: ParseLog): string {
    const lines: string[] = [
      `=== Parse Log Summary ===`,
      `Request ID: ${log.requestId}`,
      `Timestamp: ${log.timestamp}`,
      `Processing Time: ${log.processingTimeMs}ms`,
      ``,
      `Sources: ${log.sources.length}`,
      ...log.sources.map((s) => `  - ${s.type}: ${s.name}`),
      ``,
      `Input Types: ${log.detectedInputTypes.join(', ')}`,
      `Extraction Method: ${log.extractionMethod}`,
      ``,
      `Header Detection: ${log.headerDetected ? 'Yes' : 'No'} (score: ${log.headerScore.toFixed(2)})`,
    ];

    if (log.headerDetected) {
      lines.push(
        `  Line Index: ${log.headerLineIndex}`,
        `  Columns: ${log.detectedColumns.join(', ')}`
      );
    }

    lines.push(
      ``,
      `OCR Used: ${log.ocrUsed ? `Yes (pages: ${log.ocrUsedPages.join(', ')})` : 'No'}`,
      ``,
      `Images:`,
      `  Processed: ${log.processedImages.length}`,
      `  Filtered: ${log.filteredImages.length}`
    );

    if (log.filteredImages.length > 0) {
      for (const img of log.filteredImages.slice(0, 5)) {
        lines.push(`    - ${img.name}: ${img.reason}`);
      }
      if (log.filteredImages.length > 5) {
        lines.push(`    ... and ${log.filteredImages.length - 5} more`);
      }
    }

    lines.push(
      ``,
      `Lines Extracted: ${log.lineCount}`
    );

    if (log.mergedContinuationLines && log.mergedContinuationLines > 0) {
      lines.push(`Merged Continuation Lines: ${log.mergedContinuationLines}`);
    }

    if (log.extractionPath) {
      lines.push(`Extraction Path: ${log.extractionPath}`);
    }

    if (log.layoutStats) {
      lines.push(
        `Layout Stats:`,
        `  Pages: ${log.layoutStats.totalPages}`,
        `  Tokens: ${log.layoutStats.totalTokens}`,
        `  Rows: ${log.layoutStats.totalRows}`,
        `  Avg Cells/Row: ${log.layoutStats.avgCellsPerRow}`,
        `  Median Gap X: ${log.layoutStats.medianGapX}`
      );
    }

    if (log.unknownBrandCandidates && log.unknownBrandCandidates.length > 0) {
      lines.push(``, `Unknown Brand Candidates: ${log.unknownBrandCandidates.length}`);
      for (const b of log.unknownBrandCandidates.slice(0, 5)) {
        lines.push(`  - ${b}`);
      }
    }

    lines.push(``);

    if (log.warnings.length > 0) {
      lines.push(`Warnings: ${log.warnings.length}`);
      for (const w of log.warnings.slice(0, 5)) {
        lines.push(`  - ${w}`);
      }
    }

    if (log.errors.length > 0) {
      lines.push(`Errors: ${log.errors.length}`);
      for (const e of log.errors.slice(0, 5)) {
        lines.push(`  - ${e}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
}
