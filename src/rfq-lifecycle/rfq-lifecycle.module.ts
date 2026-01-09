import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { RfqLifecycleService } from './rfq-lifecycle.service';
import { QuoteComparisonService } from './quote-comparison.service';
import { ReminderService } from './reminder.service';
import { InboundScannerService } from './inbound-scanner.service';
import { RfqLifecycleController } from './rfq-lifecycle.controller';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [
    RfqLifecycleService,
    QuoteComparisonService,
    ReminderService,
    InboundScannerService,
  ],
  controllers: [RfqLifecycleController],
  exports: [
    RfqLifecycleService,
    QuoteComparisonService,
    ReminderService,
    InboundScannerService,
  ],
})
export class RfqLifecycleModule {}
