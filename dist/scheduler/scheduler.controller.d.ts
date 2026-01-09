import { SchedulerService } from './scheduler.service';
import { AutoProcessorService, ProcessResult } from './auto-processor.service';
import { DatabaseService } from '../database/database.service';
export declare class SchedulerController {
    private readonly schedulerService;
    private readonly autoProcessor;
    private readonly databaseService;
    constructor(schedulerService: SchedulerService, autoProcessor: AutoProcessorService, databaseService: DatabaseService);
    getStatus(): Promise<{
        config: {
            isActive: boolean;
            checkIntervalMinutes: number;
            folders: string[];
            endDate: Date | undefined;
            lastProcessedAt: Date | undefined;
            autoSendDraft: boolean;
        } | null;
        isRunning: boolean;
        isProcessing: boolean;
        intervalMinutes: number;
        nextExecution: Date | null;
    }>;
    start(): Promise<{
        success: boolean;
        message: string;
    }>;
    stop(): Promise<{
        success: boolean;
        message: string;
    }>;
    runOnce(): Promise<ProcessResult | {
        skipped: true;
        reason: string;
    } | {
        error: string;
    }>;
    updateConfig(body: {
        endDate?: string;
        folders?: string[];
        checkIntervalMinutes?: number;
        autoSendDraft?: boolean;
    }): Promise<{
        success: boolean;
        config: import("../database/entities").ProcessingConfig | null;
    }>;
    configure(body: {
        endDate: string;
        folders?: string[];
        checkIntervalMinutes?: number;
        autoSendDraft?: boolean;
        startImmediately?: boolean;
    }): Promise<{
        success: boolean;
        message: string;
        config: import("../database/entities").ProcessingConfig | null;
    }>;
    getOutputLogs(limit?: string, status?: string): Promise<{
        summary: {
            total: number;
            sent: number;
            failed: number;
            pending: number;
        };
        logs: any[];
    }>;
    getOutputLogsSummary(): Promise<{
        total: number;
        sent: number;
        failed: number;
        pending: number;
    }>;
    getDrafts(status?: string, limit?: string): Promise<{
        count: number;
        drafts: any[];
    }>;
    getPendingDrafts(): Promise<{
        count: number;
        drafts: any[];
    }>;
    getDraftById(id: string): Promise<{
        success: boolean;
        error: string;
        draft?: undefined;
    } | {
        success: boolean;
        draft: any;
        error?: undefined;
    }>;
    cancelDraft(id: string): Promise<{
        success: boolean;
        message: string;
    }>;
    sendPendingDraftsNow(): Promise<{
        success: boolean;
        sent: number;
        failed: number;
        errors: string[];
    }>;
    getKnownSuppliers(): Promise<{
        count: number;
        suppliers: any[];
    }>;
    addKnownSupplier(body: {
        name: string;
        email: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    removeKnownSupplier(id: string): Promise<{
        success: boolean;
        message: string;
    }>;
    getProcessingLogs(limit?: string): Promise<{
        count: number;
        logs: import("../database/entities").ProcessingLog[];
    }>;
}
