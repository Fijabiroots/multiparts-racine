import { OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { DetectorService } from '../detector/detector.service';
import { AutoProcessorService, ProcessResult } from './auto-processor.service';
import { MailService } from '../mail/mail.service';
export declare class SchedulerService implements OnModuleInit {
    private readonly configService;
    private readonly databaseService;
    private readonly emailService;
    private readonly detectorService;
    private readonly autoProcessor;
    private readonly schedulerRegistry;
    private readonly mailService;
    private readonly logger;
    private isProcessing;
    private isActive;
    private intervalId;
    private intervalMinutes;
    constructor(configService: ConfigService, databaseService: DatabaseService, emailService: EmailService, detectorService: DetectorService, autoProcessor: AutoProcessorService, schedulerRegistry: SchedulerRegistry, mailService: MailService);
    onModuleInit(): Promise<void>;
    private initializeScheduler;
    private startInterval;
    private runFullCycle;
    updateScheduleInterval(minutes: number): void;
    startScheduler(): Promise<boolean>;
    stopScheduler(): Promise<boolean>;
    processEmails(): Promise<ProcessResult | {
        skipped: true;
        reason: string;
    } | {
        error: string;
    }>;
    sendPendingDrafts(): Promise<{
        sent: number;
        failed: number;
        errors: string[];
    }>;
    runOnce(): Promise<ProcessResult | {
        skipped: true;
        reason: string;
    } | {
        error: string;
    }>;
    getStatus(): {
        isRunning: boolean;
        isProcessing: boolean;
        intervalMinutes: number;
        nextExecution: Date | null;
    };
}
