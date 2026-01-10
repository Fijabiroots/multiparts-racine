import { Injectable, Logger } from '@nestjs/common';
import { ImageFilterService, ImageMetadata } from './image-filter.service';
import { FilteredImage, ParsedRow, NormalizedDocument, SourceType } from './types';
import { EmailAttachment } from '../common/interfaces';

/**
 * Result of email body parsing
 */
export interface EmailBodyParseResult {
  plainText: string;
  htmlText: string;
  inlineImages: ImageMetadata[];
  filteredImages: FilteredImage[];
  tables: string[][][];
  rows: ParsedRow[];
  hasStructuredContent: boolean;
}

/**
 * Extracted inline image from HTML
 */
export interface InlineImage {
  src: string;
  cid?: string;
  alt?: string;
  width?: number;
  height?: number;
  positionInHtml: number;
  surroundingText: string;
  positionInEmail: 'header' | 'body' | 'footer' | 'unknown';
}

/**
 * Email Extractor Service
 *
 * Extracts content from email bodies:
 * - Plain text parsing
 * - HTML table extraction
 * - Inline image extraction with filtering
 * - CID reference resolution
 */
@Injectable()
export class EmailExtractorService {
  private readonly logger = new Logger(EmailExtractorService.name);
  private readonly imageFilter: ImageFilterService;

  constructor() {
    this.imageFilter = new ImageFilterService();
  }

  /**
   * Parse email body and extract structured content
   */
  async parseEmailBody(
    body: string,
    attachments: EmailAttachment[] = []
  ): Promise<EmailBodyParseResult> {
    const isHtml = this.isHtmlContent(body);

    let plainText: string;
    let htmlText: string;
    let tables: string[][][] = [];
    let inlineImagesInfo: InlineImage[] = [];

    if (isHtml) {
      htmlText = body;
      plainText = this.htmlToPlainText(body);
      tables = this.extractTablesFromHtml(body);
      inlineImagesInfo = this.extractInlineImagesFromHtml(body);
    } else {
      plainText = body;
      htmlText = '';
      tables = this.extractTablesFromText(plainText);
    }

    // Parse text into rows
    const rows = this.parseTextToRows(plainText);

    // Process inline images
    const { inlineImages, filteredImages } = await this.processInlineImages(
      inlineImagesInfo,
      attachments
    );

    // Determine if there's structured content
    const hasStructuredContent = tables.length > 0 || inlineImages.length > 0;

    return {
      plainText,
      htmlText,
      inlineImages,
      filteredImages,
      tables,
      rows,
      hasStructuredContent,
    };
  }

  /**
   * Create a normalized document from email body
   */
  async createNormalizedDocument(
    body: string,
    attachments: EmailAttachment[] = []
  ): Promise<NormalizedDocument> {
    const parsed = await this.parseEmailBody(body, attachments);

    return {
      sourceType: 'email_body_html' as SourceType,
      sourceName: 'email_body',
      hasPositions: false,
      rows: parsed.rows,
      tables: parsed.tables,
      rawText: parsed.plainText,
    };
  }

  /**
   * Check if content is HTML
   */
  private isHtmlContent(content: string): boolean {
    return /<html|<body|<div|<table|<p\b/i.test(content);
  }

  /**
   * Convert HTML to plain text while preserving structure
   */
  private htmlToPlainText(html: string): string {
    let text = html;

    // Remove script and style tags with content
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Convert block elements to newlines
    text = text.replace(/<\/?(div|p|br|tr|li|h\d)[^>]*>/gi, '\n');

    // Convert table cells to tabs
    text = text.replace(/<\/?(td|th)[^>]*>/gi, '\t');

    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Clean up whitespace
    text = text.replace(/\t+/g, '\t');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

    return text;
  }

  /**
   * Decode common HTML entities
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
      '&euro;': '€',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char);
    }

    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (_, num) =>
      String.fromCharCode(parseInt(num, 10))
    );
    result = result.replace(/&#x([a-fA-F0-9]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

    return result;
  }

  /**
   * Extract tables from HTML
   */
  private extractTablesFromHtml(html: string): string[][][] {
    const tables: string[][][] = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];
      const table = this.parseHtmlTable(tableHtml);

      if (table.length > 0) {
        tables.push(table);
      }
    }

    return tables;
  }

  /**
   * Parse a single HTML table into 2D array
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
   * Extract table-like structures from plain text
   */
  private extractTablesFromText(text: string): string[][][] {
    const tables: string[][][] = [];
    const lines = text.split('\n');

    // Look for tab-delimited or fixed-width tables
    let currentTable: string[][] = [];
    let prevColumnCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        // Empty line - end current table if exists
        if (currentTable.length > 1) {
          tables.push([...currentTable]);
        }
        currentTable = [];
        prevColumnCount = 0;
        continue;
      }

      // Try to split into columns
      let cells: string[];

      if (trimmed.includes('\t')) {
        cells = trimmed.split('\t').map(c => c.trim());
      } else if (trimmed.includes('  ')) {
        cells = trimmed.split(/\s{2,}/).map(c => c.trim());
      } else {
        cells = [trimmed];
      }

      // Check if this looks like a table row
      if (cells.length > 1) {
        if (prevColumnCount === 0 || cells.length === prevColumnCount) {
          currentTable.push(cells);
          prevColumnCount = cells.length;
        } else {
          // Column count changed - might be end of table
          if (currentTable.length > 1) {
            tables.push([...currentTable]);
          }
          currentTable = [cells];
          prevColumnCount = cells.length;
        }
      }
    }

    // Don't forget last table
    if (currentTable.length > 1) {
      tables.push(currentTable);
    }

    return tables;
  }

  /**
   * Extract inline image references from HTML
   */
  private extractInlineImagesFromHtml(html: string): InlineImage[] {
    const images: InlineImage[] = [];
    const imgRegex = /<img[^>]+>/gi;
    let match;

    // Estimate position in email based on common patterns
    const footerStart = html.search(
      /(signature|cordialement|regards|sincerely|--\s*\n|_{3,})/i
    );
    const headerEnd = html.search(/<body/i);

    while ((match = imgRegex.exec(html)) !== null) {
      const imgTag = match[0];
      const position = match.index;

      // Extract attributes
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const cidMatch = imgTag.match(/src=["']cid:([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      const widthMatch = imgTag.match(/width=["']?(\d+)/i);
      const heightMatch = imgTag.match(/height=["']?(\d+)/i);

      if (!srcMatch && !cidMatch) continue;

      // Get surrounding text (100 chars before and after)
      const start = Math.max(0, position - 100);
      const end = Math.min(html.length, position + imgTag.length + 100);
      const surroundingHtml = html.substring(start, end);
      const surroundingText = this.htmlToPlainText(surroundingHtml);

      // Determine position in email
      let positionInEmail: 'header' | 'body' | 'footer' | 'unknown' = 'unknown';
      if (footerStart > 0 && position > footerStart) {
        positionInEmail = 'footer';
      } else if (headerEnd > 0 && position < headerEnd + 500) {
        positionInEmail = 'header';
      } else {
        positionInEmail = 'body';
      }

      images.push({
        src: srcMatch ? srcMatch[1] : '',
        cid: cidMatch ? cidMatch[1] : undefined,
        alt: altMatch ? altMatch[1] : undefined,
        width: widthMatch ? parseInt(widthMatch[1], 10) : undefined,
        height: heightMatch ? parseInt(heightMatch[1], 10) : undefined,
        positionInHtml: position,
        surroundingText,
        positionInEmail,
      });
    }

    return images;
  }

  /**
   * Process inline images: resolve CIDs and filter
   */
  private async processInlineImages(
    inlineImagesInfo: InlineImage[],
    attachments: EmailAttachment[]
  ): Promise<{
    inlineImages: ImageMetadata[];
    filteredImages: FilteredImage[];
  }> {
    const imagesToProcess: ImageMetadata[] = [];

    // Build CID map from attachments
    const cidMap = new Map<string, EmailAttachment>();
    for (const att of attachments) {
      // Check for Content-ID header (typically in format <cid>)
      const filename = att.filename.toLowerCase();
      // Common inline image patterns
      if (filename.match(/^image\d+\./i) || filename.includes('cid')) {
        cidMap.set(filename, att);
      }
    }

    for (const imgInfo of inlineImagesInfo) {
      // Try to resolve CID
      let attachment: EmailAttachment | undefined;

      if (imgInfo.cid) {
        attachment = cidMap.get(imgInfo.cid.toLowerCase());
        if (!attachment) {
          // Try with common patterns
          for (const [key, att] of cidMap) {
            if (key.includes(imgInfo.cid.toLowerCase())) {
              attachment = att;
              break;
            }
          }
        }
      }

      // If we found the attachment, create ImageMetadata
      if (attachment) {
        imagesToProcess.push({
          filename: attachment.filename,
          buffer: attachment.content,
          contentType: attachment.contentType,
          size: attachment.size,
          isInline: true,
          positionInEmail: imgInfo.positionInEmail,
          cidReference: imgInfo.cid,
          surroundingText: imgInfo.surroundingText,
        });
      } else if (imgInfo.src && !imgInfo.src.startsWith('data:')) {
        // External URL - we can't process these directly
        // but we should note them for potential fetching
        this.logger.debug(`External inline image: ${imgInfo.src}`);
      }
    }

    // Also check regular image attachments that might be document images
    for (const att of attachments) {
      const isImage = att.contentType?.startsWith('image/') ||
        /\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i.test(att.filename);

      if (isImage) {
        const alreadyProcessed = imagesToProcess.some(
          img => img.filename === att.filename
        );

        if (!alreadyProcessed) {
          imagesToProcess.push({
            filename: att.filename,
            buffer: att.content,
            contentType: att.contentType,
            size: att.size,
            isInline: false,
            positionInEmail: 'unknown',
          });
        }
      }
    }

    // Filter images
    const { accepted, filtered } = await this.imageFilter.filterImages(imagesToProcess);
    return {
      inlineImages: accepted,
      filteredImages: filtered,
    };
  }

  /**
   * Parse plain text into structured rows
   */
  private parseTextToRows(text: string): ParsedRow[] {
    const rows: ParsedRow[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) continue;

      // Determine if this is a continuation line
      const isContinuation = !trimmed.match(/^\d/) && // Doesn't start with number
        !trimmed.match(/^[A-Z]/) &&                   // Doesn't start with capital
        trimmed.length < 100 &&                       // Relatively short
        rows.length > 0;                              // Has previous line

      rows.push({
        raw: line,
        cells: this.splitRowIntoCells(trimmed),
        lineNumber: i + 1,
        isContinuation,
      });
    }

    return rows;
  }

  /**
   * Split a text row into cells
   */
  private splitRowIntoCells(row: string): string[] {
    // Try tab first
    if (row.includes('\t')) {
      return row.split('\t').map(c => c.trim());
    }

    // Try semicolon
    if (row.includes(';')) {
      return row.split(';').map(c => c.trim());
    }

    // Try multiple spaces (3+)
    const spaceSplit = row.split(/\s{3,}/);
    if (spaceSplit.length > 2) {
      return spaceSplit.map(c => c.trim());
    }

    // Return as single cell
    return [row.trim()];
  }

  /**
   * Clean email body by removing common noise
   */
  cleanEmailBody(body: string): string {
    let cleaned = body;

    // Remove email headers
    cleaned = cleaned.replace(
      /^(From|To|Cc|Bcc|Subject|Sent|Date):\s*.+$/gmi,
      ''
    );

    // Remove signature delimiters
    cleaned = cleaned.replace(/^--\s*$/gm, '');
    cleaned = cleaned.replace(/^_{3,}$/gm, '');

    // Remove quoted replies
    cleaned = cleaned.replace(/^>.*$/gm, '');
    cleaned = cleaned.replace(/^On .+ wrote:$/gm, '');
    cleaned = cleaned.replace(/^Le .+ a écrit\s*:$/gm, '');

    // Remove common disclaimers
    cleaned = cleaned.replace(
      /this (email|message) (and any|is confidential).+$/gims,
      ''
    );
    cleaned = cleaned.replace(
      /ce (courriel|message) (est|et ses).+$/gims,
      ''
    );

    // Clean up whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
  }
}
