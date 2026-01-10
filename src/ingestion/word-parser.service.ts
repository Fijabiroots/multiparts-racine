import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { NormalizedDocument, SourceType, ParsedRow } from './types';
import { EmailAttachment } from '../common/interfaces';

/**
 * Word document parse result
 */
export interface WordParseResult {
  rawText: string;
  htmlText: string;
  tables: string[][][];
  rows: ParsedRow[];
  images: Buffer[];
  warnings: string[];
}

/**
 * Word Parser Service
 *
 * Enhanced Word document parsing with:
 * - Table structure extraction (via HTML intermediate)
 * - Text extraction preserving layout
 * - Image extraction (for potential OCR)
 */
@Injectable()
export class WordParserService {
  private readonly logger = new Logger(WordParserService.name);

  /**
   * Parse a Word document
   */
  async parseDocument(attachment: EmailAttachment): Promise<WordParseResult> {
    const warnings: string[] = [];
    const images: Buffer[] = [];

    try {
      // Extract HTML (preserves table structure)
      const htmlResult = await mammoth.convertToHtml(
        { buffer: attachment.content },
        {
          convertImage: mammoth.images.imgElement((image) => {
            // Capture images for potential OCR
            return image.read().then((buffer) => {
              images.push(buffer);
              return { src: `embedded-image-${images.length}` };
            });
          }),
        }
      );

      const htmlText = htmlResult.value;

      // Collect warnings from mammoth
      for (const msg of htmlResult.messages) {
        if (msg.type === 'warning') {
          warnings.push(msg.message);
        }
      }

      // Also extract raw text
      const textResult = await mammoth.extractRawText({
        buffer: attachment.content,
      });
      const rawText = textResult.value;

      // Extract tables from HTML
      const tables = this.extractTablesFromHtml(htmlText);

      // Parse text into rows
      const rows = this.parseTextToRows(rawText);

      this.logger.debug(
        `Word document parsed: ${rawText.length} chars, ${tables.length} tables, ${images.length} images`
      );

      return {
        rawText,
        htmlText,
        tables,
        rows,
        images,
        warnings,
      };
    } catch (error) {
      this.logger.error(`Failed to parse Word document: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a normalized document from Word file
   */
  async createNormalizedDocument(
    attachment: EmailAttachment
  ): Promise<NormalizedDocument> {
    const parsed = await this.parseDocument(attachment);

    return {
      sourceType: 'attachment_word' as SourceType,
      sourceName: attachment.filename,
      hasPositions: false,
      rows: parsed.rows,
      tables: parsed.tables,
      rawText: parsed.rawText,
    };
  }

  /**
   * Extract tables from mammoth HTML output
   */
  private extractTablesFromHtml(html: string): string[][][] {
    const tables: string[][][] = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];
      const table = this.parseHtmlTable(tableHtml);

      if (table.length > 0 && table[0].length > 0) {
        tables.push(table);
      }
    }

    return tables;
  }

  /**
   * Parse HTML table into 2D array
   */
  private parseHtmlTable(tableHtml: string): string[][] {
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: string[] = [];
      const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        let cellContent = cellMatch[2];
        // Strip HTML tags from cell content
        cellContent = cellContent.replace(/<[^>]+>/g, '');
        // Decode entities
        cellContent = this.decodeHtmlEntities(cellContent);
        cells.push(cellContent.trim());
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    return rows;
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&#39;': "'",
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char);
    }

    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (_, num) =>
      String.fromCharCode(parseInt(num, 10))
    );

    return result;
  }

  /**
   * Parse raw text into rows
   */
  private parseTextToRows(text: string): ParsedRow[] {
    const rows: ParsedRow[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) continue;

      rows.push({
        raw: line,
        cells: this.splitRowIntoCells(trimmed),
        lineNumber: i + 1,
        isContinuation: this.isContinuationLine(trimmed, rows),
      });
    }

    return rows;
  }

  /**
   * Split row into cells using delimiters
   */
  private splitRowIntoCells(row: string): string[] {
    // Try tab first
    if (row.includes('\t')) {
      return row.split('\t').map((c) => c.trim());
    }

    // Try semicolon
    if (row.includes(';')) {
      return row.split(';').map((c) => c.trim());
    }

    // Try multiple spaces (3+)
    const spaceSplit = row.split(/\s{3,}/);
    if (spaceSplit.length > 2) {
      return spaceSplit.map((c) => c.trim());
    }

    return [row.trim()];
  }

  /**
   * Check if line is a continuation
   */
  private isContinuationLine(line: string, previousRows: ParsedRow[]): boolean {
    if (previousRows.length === 0) return false;

    // Doesn't start with number or capital letter
    if (/^[A-Z0-9]/.test(line)) return false;

    // Short line following a longer one
    const lastRow = previousRows[previousRows.length - 1];
    if (line.length < 80 && lastRow.raw.length > line.length * 1.5) {
      return true;
    }

    return false;
  }
}
