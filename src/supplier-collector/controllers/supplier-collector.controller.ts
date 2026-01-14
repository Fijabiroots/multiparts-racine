import { Controller, Get, Post, Query, Logger } from '@nestjs/common';
import { MailSyncService } from '../services/mail-sync.service';
import { SupplierDirectoryService } from '../services/supplier-directory.service';
import { BrandMatcherService } from '../services/brand-matcher.service';

/**
 * SupplierCollectorController
 *
 * API REST pour le module Supplier Collector.
 * Endpoints pour la synchronisation, l'export et les statistiques.
 */
@Controller('api/supplier-collector')
export class SupplierCollectorController {
  private readonly logger = new Logger(SupplierCollectorController.name);

  constructor(
    private mailSyncService: MailSyncService,
    private directoryService: SupplierDirectoryService,
    private brandMatcherService: BrandMatcherService,
  ) {}

  // ============ SYNC ENDPOINTS ============

  /**
   * GET /api/supplier-collector/sync/status
   * Retourne le status de la synchronisation
   */
  @Get('sync/status')
  getSyncStatus() {
    return this.mailSyncService.getStatus();
  }

  /**
   * POST /api/supplier-collector/sync/trigger
   * Déclenche une synchronisation manuelle
   */
  @Post('sync/trigger')
  async triggerSync() {
    this.logger.log('Manual sync triggered');
    const results = await this.mailSyncService.syncAllFolders();
    return {
      success: true,
      results,
    };
  }

  /**
   * POST /api/supplier-collector/sync/trigger/:folder
   * Déclenche une synchronisation pour un dossier spécifique
   */
  @Post('sync/trigger/:folder')
  async triggerFolderSync(@Query('folder') folder: 'INBOX' | 'SENT') {
    this.logger.log(`Manual sync triggered for folder: ${folder}`);
    const result = await this.mailSyncService.syncFolder(folder);
    return {
      success: true,
      result,
    };
  }

  /**
   * POST /api/supplier-collector/sync/reprocess
   * Retraite les emails non classifiés
   */
  @Post('sync/reprocess')
  async reprocessUnclassified() {
    const count = await this.mailSyncService.reprocessUnclassified();
    return {
      success: true,
      processed: count,
    };
  }

  // ============ EXPORT ENDPOINTS ============

  /**
   * GET /api/supplier-collector/exports/brand-suppliers.json
   * Exporte l'annuaire Marque → Fournisseurs
   */
  @Get('exports/brand-suppliers.json')
  async exportBrandSuppliers(@Query('format') format: 'simple' | 'detailed' = 'simple') {
    if (format === 'detailed') {
      return this.directoryService.exportDetailed();
    }
    return this.directoryService.exportSimple();
  }

  /**
   * GET /api/supplier-collector/exports/stats
   * Retourne les statistiques de l'annuaire
   */
  @Get('exports/stats')
  async getStats() {
    return this.directoryService.getStats();
  }

  /**
   * GET /api/supplier-collector/exports/brands
   * Liste toutes les marques avec leurs fournisseurs
   */
  @Get('exports/brands')
  async getBrands() {
    return this.directoryService.exportSimple();
  }

  // ============ SUPPLIER LOOKUP ============

  /**
   * GET /api/supplier-collector/suppliers
   * Récupère les fournisseurs pour une ou plusieurs marques
   */
  @Get('suppliers')
  async getSuppliersForBrands(@Query('brands') brandsParam: string) {
    if (!brandsParam) {
      return { error: 'Parameter "brands" is required (comma-separated list)' };
    }

    const brandNames = brandsParam.split(',').map(b => b.trim());
    const suppliersMap = await this.directoryService.getSuppliersForBrands(brandNames);

    const result: Record<string, any[]> = {};
    suppliersMap.forEach((suppliers, brand) => {
      result[brand] = suppliers;
    });

    return {
      brands: brandNames,
      suppliers: result,
    };
  }

  /**
   * GET /api/supplier-collector/suppliers/emails
   * Récupère les emails uniques pour des marques (pour BCC)
   */
  @Get('suppliers/emails')
  async getSupplierEmails(@Query('brands') brandsParam: string) {
    if (!brandsParam) {
      return { error: 'Parameter "brands" is required (comma-separated list)' };
    }

    const brandNames = brandsParam.split(',').map(b => b.trim());
    const emails = await this.directoryService.getUniqueSupplierEmailsForBrands(brandNames);

    return {
      brands: brandNames,
      emails,
      count: emails.length,
    };
  }

  // ============ BRAND MANAGEMENT ============

  /**
   * GET /api/supplier-collector/brands
   * Liste toutes les marques du fichier JSON
   */
  @Get('brands')
  async getAllBrands() {
    const brands = this.brandMatcherService.getAllBrands();
    const stats = this.brandMatcherService.getStats();

    return {
      ...stats,
      brands: brands.map(b => ({
        name: b.name,
        category: b.category,
        categoryLabel: b.categoryLabel,
      })),
    };
  }

  /**
   * GET /api/supplier-collector/brands/stats
   * Statistiques des marques
   */
  @Get('brands/stats')
  async getBrandStats() {
    return this.brandMatcherService.getStats();
  }

  /**
   * POST /api/supplier-collector/brands/refresh
   * Recharge les marques depuis le fichier JSON
   */
  @Post('brands/refresh')
  async refreshBrands() {
    await this.brandMatcherService.refreshBrands();
    return {
      success: true,
      stats: this.brandMatcherService.getStats(),
    };
  }
}
