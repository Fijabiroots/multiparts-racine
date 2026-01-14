import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// Config
import { reminderConfig } from './config/reminder.config';

// Services
import { ReminderPolicyService } from './services/reminder-policy.service';
import { ConversationLinkerService } from './services/conversation-linker.service';
import { ClassifierClientChaserService } from './services/classifier-client-chaser.service';
import { CustomerAutoResponseService } from './services/customer-auto-response.service';
import { SupplierReminderService } from './services/supplier-reminder.service';
import { ReminderDatabaseService } from './services/reminder-database.service';
import { ReminderMailService } from './services/reminder-mail.service';
import { ReminderSchedulerService } from './services/reminder-scheduler.service';

// Controller
import { ReminderController } from './reminder.controller';

// External modules
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    ConfigModule.forFeature(reminderConfig),
    ScheduleModule.forRoot(),
    DatabaseModule,
    forwardRef(() => EmailModule),
  ],
  controllers: [ReminderController],
  providers: [
    // Core services
    ReminderPolicyService,
    ReminderDatabaseService,
    ReminderMailService,

    // Business logic services
    ConversationLinkerService,
    ClassifierClientChaserService,
    CustomerAutoResponseService,
    SupplierReminderService,

    // Scheduler
    ReminderSchedulerService,
  ],
  exports: [
    // Export services that other modules might need
    ReminderPolicyService,
    ConversationLinkerService,
    ClassifierClientChaserService,
    CustomerAutoResponseService,
    SupplierReminderService,
    ReminderDatabaseService,
    ReminderMailService,
    ReminderSchedulerService,
  ],
})
export class ReminderModule {}
