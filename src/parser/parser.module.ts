import { Module } from '@nestjs/common';
import { DocumentParserService } from './document-parser.service';
import { AttachmentClassifierService } from './attachment-classifier.service';

@Module({
  providers: [DocumentParserService, AttachmentClassifierService],
  exports: [DocumentParserService, AttachmentClassifierService],
})
export class ParserModule {}
