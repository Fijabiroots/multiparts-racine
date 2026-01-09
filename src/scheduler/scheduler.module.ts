import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { AutoProcessorService } from './auto-processor.service';
import { SchedulerController } from './scheduler.controller';
import { EmailModule } from '../email/email.module';
import { DetectorModule } from '../detector/detector.module';
import { ParserModule } from '../parser/parser.module';
import { ExcelModule } from '../excel/excel.module';
import { DraftModule } from '../draft/draft.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EmailModule,
    DetectorModule,
    ParserModule,
    ExcelModule,
    DraftModule,
    MailModule,
  ],
  providers: [SchedulerService, AutoProcessorService],
  controllers: [SchedulerController],
  exports: [SchedulerService, AutoProcessorService],
})
export class SchedulerModule {}
