import { Controller, Post, Get, Body, Put, Query, Param, Delete } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { AutoProcessorService, ProcessResult } from './auto-processor.service';
import { DatabaseService } from '../database/database.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly autoProcessor: AutoProcessorService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Get('status')
  async getStatus() {
    const status = this.schedulerService.getStatus();
    const config = await this.databaseService.getProcessingConfig();
    
    return {
      ...status,
      config: config ? {
        isActive: config.isActive,
        checkIntervalMinutes: config.checkIntervalMinutes,
        folders: config.folders,
        endDate: config.endDate,
        lastProcessedAt: config.lastProcessedAt,
        autoSendDraft: config.autoSendDraft,
      } : null,
    };
  }

  @Post('start')
  async start() {
    await this.databaseService.updateProcessingConfig({ isActive: true });
    const success = await this.schedulerService.startScheduler();
    return { success, message: success ? 'Scheduler démarré' : 'Erreur démarrage' };
  }

  @Post('stop')
  async stop() {
    await this.databaseService.updateProcessingConfig({ isActive: false });
    const success = await this.schedulerService.stopScheduler();
    return { success, message: success ? 'Scheduler arrêté' : 'Erreur arrêt' };
  }

  @Post('run-once')
  async runOnce(): Promise<ProcessResult | { skipped: true; reason: string } | { error: string }> {
    const result = await this.schedulerService.runOnce();
    return result;
  }

  @Put('config')
  async updateConfig(@Body() body: {
    endDate?: string;
    folders?: string[];
    checkIntervalMinutes?: number;
    autoSendDraft?: boolean;
  }) {
    await this.databaseService.updateProcessingConfig({
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      folders: body.folders,
      checkIntervalMinutes: body.checkIntervalMinutes,
      autoSendDraft: body.autoSendDraft,
    });

    // Si l'intervalle change, mettre à jour le scheduler
    if (body.checkIntervalMinutes) {
      this.schedulerService.updateScheduleInterval(body.checkIntervalMinutes);
    }

    const config = await this.databaseService.getProcessingConfig();
    return { success: true, config };
  }

  @Post('configure')
  async configure(@Body() body: {
    endDate: string;
    folders?: string[];
    checkIntervalMinutes?: number;
    autoSendDraft?: boolean;
    startImmediately?: boolean;
  }) {
    // Mettre à jour la configuration
    await this.databaseService.updateProcessingConfig({
      endDate: new Date(body.endDate),
      folders: body.folders || ['INBOX'],
      checkIntervalMinutes: body.checkIntervalMinutes || 5,
      autoSendDraft: body.autoSendDraft !== false,
      isActive: body.startImmediately !== false,
    });

    const config = await this.databaseService.getProcessingConfig();

    // Démarrer si demandé
    if (body.startImmediately !== false && config) {
      this.schedulerService.updateScheduleInterval(config.checkIntervalMinutes);
      await this.schedulerService.startScheduler();
    }

    return {
      success: true,
      message: body.startImmediately !== false 
        ? 'Configuration appliquée et scheduler démarré' 
        : 'Configuration appliquée (scheduler non démarré)',
      config,
    };
  }

  // ============ LOGS D'OUTPUT ============

  @Get('output-logs')
  async getOutputLogs(@Query('limit') limit?: string, @Query('status') status?: string) {
    const logs = await this.databaseService.getOutputLogs(
      limit ? parseInt(limit, 10) : 100,
      status,
    );
    const summary = await this.databaseService.getOutputLogsSummary();
    
    return {
      summary,
      logs,
    };
  }

  @Get('output-logs/summary')
  async getOutputLogsSummary() {
    return this.databaseService.getOutputLogsSummary();
  }

  // ============ BROUILLONS EN ATTENTE ============

  @Get('drafts')
  async getDrafts(@Query('status') status?: string, @Query('limit') limit?: string) {
    const drafts = await this.databaseService.getAllDrafts(
      status,
      limit ? parseInt(limit, 10) : 50,
    );
    return { count: drafts.length, drafts };
  }

  @Get('drafts/pending')
  async getPendingDrafts() {
    const drafts = await this.databaseService.getPendingDraftsToSend();
    return { count: drafts.length, drafts };
  }

  @Get('drafts/:id')
  async getDraftById(@Param('id') id: string) {
    const draft = await this.databaseService.getDraftById(id);
    if (!draft) {
      return { success: false, error: 'Brouillon non trouvé' };
    }
    return { success: true, draft };
  }

  @Post('drafts/:id/cancel')
  async cancelDraft(@Param('id') id: string) {
    await this.databaseService.updateDraftStatus(id, 'cancelled');
    return { success: true, message: 'Brouillon annulé' };
  }

  @Post('drafts/send-now')
  async sendPendingDraftsNow() {
    const result = await this.schedulerService.sendPendingDrafts();
    return {
      success: true,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors,
    };
  }

  // ============ FOURNISSEURS CONNUS ============

  @Get('suppliers')
  async getKnownSuppliers() {
    const suppliers = await this.databaseService.getAllKnownSuppliers();
    return { count: suppliers.length, suppliers };
  }

  @Post('suppliers')
  async addKnownSupplier(@Body() body: { name: string; email: string }) {
    await this.databaseService.addKnownSupplier(body.name, body.email);
    return { success: true, message: `Fournisseur ${body.name} ajouté` };
  }

  @Delete('suppliers/:id')
  async removeKnownSupplier(@Param('id') id: string) {
    await this.databaseService.removeKnownSupplier(id);
    return { success: true, message: 'Fournisseur supprimé' };
  }

  // ============ PROCESSING LOGS ============

  @Get('processing-logs')
  async getProcessingLogs(@Query('limit') limit?: string) {
    const logs = await this.databaseService.getProcessingLogs(
      limit ? parseInt(limit, 10) : 100,
    );
    return { count: logs.length, logs };
  }
}
