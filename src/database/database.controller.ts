import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { Client } from './entities';

@Controller('database')
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  // ============ CLIENTS ============

  @Get('clients')
  async getAllClients() {
    const clients = await this.databaseService.getAllClients();
    return { count: clients.length, clients };
  }

  @Get('clients/:id')
  async getClient(@Param('id') id: string) {
    const client = await this.databaseService.getClientById(id);
    if (!client) {
      return { error: 'Client non trouvé' };
    }
    return client;
  }

  @Get('clients/by-email/:email')
  async getClientByEmail(@Param('email') email: string) {
    const client = await this.databaseService.getClientByEmail(email);
    if (!client) {
      return { error: 'Client non trouvé' };
    }
    return client;
  }

  @Post('clients')
  async createClient(@Body() body: {
    code: string;
    name: string;
    email: string;
    alternateEmails?: string[];
    phone?: string;
    address?: string;
    contactPerson?: string;
  }) {
    const client = await this.databaseService.createClient(body);
    return { success: true, client };
  }

  @Put('clients/:id')
  async updateClient(@Param('id') id: string, @Body() body: Partial<Client>) {
    const client = await this.databaseService.updateClient(id, body);
    if (!client) {
      return { error: 'Client non trouvé' };
    }
    return { success: true, client };
  }

  // ============ RFQ MAPPINGS ============

  @Get('rfq-mappings')
  async getAllRfqMappings(@Query('limit') limit?: string) {
    const mappings = await this.databaseService.getAllRfqMappings(limit ? parseInt(limit, 10) : 100);
    return { count: mappings.length, mappings };
  }

  @Get('rfq-mappings/:id')
  async getRfqMapping(@Param('id') id: string) {
    const mapping = await this.databaseService.getRfqMappingById(id);
    if (!mapping) {
      return { error: 'Mapping non trouvé' };
    }
    return mapping;
  }

  @Get('rfq-mappings/by-client-rfq/:rfqNumber')
  async getRfqMappingByClientRfq(@Param('rfqNumber') rfqNumber: string) {
    const mapping = await this.databaseService.getRfqMappingByClientRfq(rfqNumber);
    if (!mapping) {
      return { error: 'Mapping non trouvé' };
    }
    return mapping;
  }

  @Get('rfq-mappings/by-internal-rfq/:rfqNumber')
  async getRfqMappingByInternalRfq(@Param('rfqNumber') rfqNumber: string) {
    const mapping = await this.databaseService.getRfqMappingByInternalRfq(rfqNumber);
    if (!mapping) {
      return { error: 'Mapping non trouvé' };
    }
    return mapping;
  }

  @Get('rfq-mappings/client/:clientId')
  async getClientRfqMappings(@Param('clientId') clientId: string) {
    const mappings = await this.databaseService.getClientRfqMappings(clientId);
    return { count: mappings.length, mappings };
  }

  // ============ CONFIGURATION ============

  @Get('config')
  async getConfig() {
    const config = await this.databaseService.getProcessingConfig();
    return config || { error: 'Configuration non trouvée' };
  }

  @Put('config')
  async updateConfig(@Body() body: {
    startDate?: string;
    endDate?: string;
    folders?: string[];
    autoSendDraft?: boolean;
    checkIntervalMinutes?: number;
    isActive?: boolean;
  }) {
    await this.databaseService.updateProcessingConfig({
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      folders: body.folders,
      autoSendDraft: body.autoSendDraft,
      checkIntervalMinutes: body.checkIntervalMinutes,
      isActive: body.isActive,
    });
    const config = await this.databaseService.getProcessingConfig();
    return { success: true, config };
  }

  // ============ KEYWORDS ============

  @Get('keywords')
  async getKeywords() {
    const keywords = await this.databaseService.getDetectionKeywords();
    return { count: keywords.length, keywords };
  }

  @Post('keywords')
  async addKeyword(@Body() body: {
    keyword: string;
    weight: number;
    language: 'fr' | 'en' | 'both';
    type: 'subject' | 'body' | 'both';
  }) {
    await this.databaseService.addDetectionKeyword(body);
    return { success: true };
  }

  // ============ LOGS ============

  @Get('logs')
  async getLogs(@Query('limit') limit?: string) {
    const logs = await this.databaseService.getProcessingLogs(limit ? parseInt(limit, 10) : 100);
    return { count: logs.length, logs };
  }
}
