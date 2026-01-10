import { Module } from '@nestjs/common';
import { ImageFilterService } from './image-filter.service';
import { TableParserService } from './table-parser.service';
import { EmailExtractorService } from './email-extractor.service';
import { WordParserService } from './word-parser.service';
import { ParseLogService } from './parse-log.service';
import { UnifiedIngestionService } from './unified-ingestion.service';

/**
 * Ingestion Module
 *
 * Provides unified document ingestion services for RFQ processing:
 * - Image filtering (signatures, icons)
 * - Table parsing with header detection
 * - Email body extraction
 * - Word document parsing
 * - Parse log generation
 */
@Module({
  providers: [
    ImageFilterService,
    TableParserService,
    EmailExtractorService,
    WordParserService,
    ParseLogService,
    UnifiedIngestionService,
  ],
  exports: [
    ImageFilterService,
    TableParserService,
    EmailExtractorService,
    WordParserService,
    ParseLogService,
    UnifiedIngestionService,
  ],
})
export class IngestionModule {}
