import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { PdfModule } from './pdf/pdf.module';
import { ExcelModule } from './excel/excel.module';
import { DraftModule } from './draft/draft.module';
import { ParserModule } from './parser/parser.module';
import { DetectorModule } from './detector/detector.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PriceRequestModule } from './price-request/price-request.module';
import { ReviewModule } from './review/review.module';
import { AcknowledgmentModule } from './acknowledgment/acknowledgment.module';
import { TrackingModule } from './tracking/tracking.module';
import { WebhookModule } from './webhook/webhook.module';
import { RfqLifecycleModule } from './rfq-lifecycle/rfq-lifecycle.module';
import { BrandIntelligenceModule } from './brand-intelligence/brand-intelligence.module';
import { LlmModule } from './llm';
import { ReminderModule } from './reminder/reminder.module';
import { SupplierCollectorModule } from './supplier-collector/supplier-collector.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    // Servir les fichiers statiques (interface de révision)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
    }),
    // Modules globaux en premier
    WebhookModule,
    BrandIntelligenceModule,
    // Autres modules
    DatabaseModule,
    EmailModule,
    PdfModule,
    ExcelModule,
    DraftModule,
    ParserModule,
    DetectorModule,
    SchedulerModule,
    PriceRequestModule,
    ReviewModule,
    AcknowledgmentModule,
    TrackingModule,
    RfqLifecycleModule,
    LlmModule,
    ReminderModule,
    SupplierCollectorModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
