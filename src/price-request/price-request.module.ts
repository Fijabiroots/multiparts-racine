import { Module } from '@nestjs/common';
import { PriceRequestService } from './price-request.service';
import { PriceRequestController } from './price-request.controller';
import { EmailModule } from '../email/email.module';
import { PdfModule } from '../pdf/pdf.module';
import { ExcelModule } from '../excel/excel.module';
import { DraftModule } from '../draft/draft.module';
import { AcknowledgmentModule } from '../acknowledgment/acknowledgment.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [EmailModule, PdfModule, ExcelModule, DraftModule, AcknowledgmentModule, TrackingModule],
  providers: [PriceRequestService],
  controllers: [PriceRequestController],
  exports: [PriceRequestService],
})
export class PriceRequestModule {}
