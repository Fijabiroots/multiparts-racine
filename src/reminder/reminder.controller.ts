import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ReminderSchedulerService } from './services/reminder-scheduler.service';
import { SupplierReminderService } from './services/supplier-reminder.service';
import { ClassifierClientChaserService } from './services/classifier-client-chaser.service';
import { ConversationLinkerService } from './services/conversation-linker.service';
import { ReminderDatabaseService } from './services/reminder-database.service';
import { ReminderPolicyService } from './services/reminder-policy.service';
import { InboundEmail } from './interfaces/reminder.interfaces';

@Controller('api/reminder')
export class ReminderController {
  constructor(
    private readonly schedulerService: ReminderSchedulerService,
    private readonly supplierReminderService: SupplierReminderService,
    private readonly classifierService: ClassifierClientChaserService,
    private readonly linkerService: ConversationLinkerService,
    private readonly reminderDbService: ReminderDatabaseService,
    private readonly policyService: ReminderPolicyService,
  ) {}

  // ============ Status & Control ============

  @Get('status')
  getStatus() {
    return {
      scheduler: this.schedulerService.getStatus(),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('enable')
  enable() {
    this.schedulerService.setEnabled(true);
    return { success: true, enabled: true };
  }

  @Post('disable')
  disable() {
    this.schedulerService.setEnabled(false);
    return { success: true, enabled: false };
  }

  // ============ Manual Triggers ============

  @Post('trigger/supplier-reminders')
  async triggerSupplierReminders() {
    const result = await this.schedulerService.triggerSupplierReminders();
    return {
      success: true,
      result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('trigger/customer-processing')
  async triggerCustomerProcessing() {
    const result = await this.schedulerService.triggerCustomerProcessing();
    return {
      success: true,
      result,
      timestamp: new Date().toISOString(),
    };
  }

  // ============ Supplier Reminders ============

  @Get('supplier/pending')
  async getPendingSupplierReminders() {
    const reminders = await this.supplierReminderService.getPendingReminders();
    return {
      count: reminders.length,
      reminders,
    };
  }

  @Post('supplier/schedule')
  async scheduleSupplierReminder(@Body() body: {
    rfqId: string;
    internalRfqNumber: string;
    supplierEmail: string;
    sentAt?: string;
  }) {
    const result = await this.supplierReminderService.scheduleReminderForRfq(
      body.rfqId,
      body.internalRfqNumber,
      body.supplierEmail,
      body.sentAt ? new Date(body.sentAt) : undefined,
    );
    return result;
  }

  @Post('supplier/:rfqId/responded')
  async markSupplierResponded(@Param('rfqId') rfqId: string) {
    await this.supplierReminderService.markAsResponded(rfqId);
    return { success: true };
  }

  // ============ Classifier Testing ============

  @Post('classify')
  async classifyEmail(@Body() email: InboundEmail) {
    const linkResult = await this.linkerService.matchInboundCustomerEmailToRequest(email);
    const classifierResult = await this.classifierService.classify(email, linkResult.requestContext);
    const requestState = this.classifierService.determineRequestState(linkResult.requestContext);

    return {
      linkResult,
      classifierResult,
      requestState,
    };
  }

  @Post('analyze-text')
  async analyzeText(@Body() body: { subject: string; bodyText: string }) {
    const email: InboundEmail = {
      id: 'test',
      messageId: 'test@test.com',
      from: 'test@example.com',
      to: ['multiparts@multipartsci.com'],
      subject: body.subject,
      bodyText: body.bodyText,
      date: new Date(),
      headers: {},
    };

    const classifierResult = await this.classifierService.classify(email);

    return {
      normalizedSubject: this.linkerService.normalizeSubject(body.subject),
      extractedTokens: this.linkerService.extractRfqTokens(body.subject + ' ' + body.bodyText),
      classifierResult,
    };
  }

  // ============ Policy Testing ============

  @Get('policy/due-date')
  calculateDueDate(@Query('sentAt') sentAtStr: string, @Query('slaDays') slaDaysStr?: string) {
    const sentAt = new Date(sentAtStr);
    const slaDays = slaDaysStr ? parseInt(slaDaysStr, 10) : undefined;

    const result = this.policyService.computeNextBusinessDueDate(sentAt, slaDays);

    return {
      input: { sentAt: sentAt.toISOString(), slaDays },
      result: {
        dueDate: result.dueDate.toISOString(),
        originalDueDate: result.originalDueDate.toISOString(),
        wasPostponed: result.wasPostponed,
        postponeReason: result.postponeReason,
        dayOfWeek: result.dueDate.toLocaleDateString('en-US', { weekday: 'long' }),
      },
    };
  }

  @Get('policy/business-days')
  getBusinessDays(
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ) {
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      businessDays: this.policyService.getBusinessDaysBetween(startDate, endDate),
    };
  }

  // ============ Logs ============

  @Get('logs/auto-emails')
  async getAutoEmailLogs(
    @Query('type') type?: string,
    @Query('requestId') requestId?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const logs = await this.reminderDbService.getAutoEmailLogs({
      type: type as any,
      requestId,
      limit,
    });

    return {
      count: logs.length,
      logs,
    };
  }

  // ============ Conversations ============

  @Get('conversations/:requestId')
  async getConversation(
    @Param('requestId') requestId: string,
    @Query('customerEmail') customerEmail: string,
  ) {
    const conversation = await this.reminderDbService.getConversationByRequest(
      requestId,
      customerEmail,
    );

    return { conversation };
  }
}
