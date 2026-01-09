import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { BrandIntelligenceService } from './brand-intelligence.service';
import { AutoSendConfig } from './brand.interface';

@Controller('brand-intelligence')
export class BrandIntelligenceController {
  constructor(private readonly brandService: BrandIntelligenceService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTIQUES ET DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /brand-intelligence/stats
   * Statistiques globales
   */
  @Get('stats')
  getStatistics() {
    return {
      success: true,
      data: this.brandService.getStatistics(),
    };
  }

  /**
   * GET /brand-intelligence/categories
   * Liste des catégories
   */
  @Get('categories')
  getCategories() {
    return {
      success: true,
      data: this.brandService.getCategories(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARQUES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /brand-intelligence/brands/search?q=xxx
   * Rechercher des marques
   */
  @Get('brands/search')
  searchBrands(
    @Query('q') query: string,
    @Query('limit') limit?: string
  ) {
    const results = this.brandService.searchBrands(
      query || '',
      limit ? parseInt(limit, 10) : 20
    );
    return {
      success: true,
      query,
      count: results.length,
      data: results,
    };
  }

  /**
   * GET /brand-intelligence/brands/category/:key
   * Marques par catégorie
   */
  @Get('brands/category/:key')
  getBrandsByCategory(@Param('key') categoryKey: string) {
    const brands = this.brandService.getBrandsByCategory(categoryKey);
    return {
      success: true,
      category: categoryKey,
      count: brands.length,
      data: brands,
    };
  }

  /**
   * GET /brand-intelligence/brands/:name
   * Détail d'une marque
   */
  @Get('brands/:name')
  getBrandDetail(@Param('name') name: string) {
    const brand = this.brandService.findBrand(name);
    if (!brand) {
      return { success: false, error: 'Marque non trouvée' };
    }

    const suppliers = this.brandService.getSuppliersByBrand(brand.name);
    return {
      success: true,
      data: {
        brand,
        suppliers: suppliers.map(s => ({
          email: s.supplierEmail,
          name: s.supplierName,
          reliability: s.reliability,
          quotesCount: s.quotesCount,
          isPreferred: s.isPreferred,
          lastQuoteAt: s.lastQuoteAt,
        })),
      },
    };
  }

  /**
   * POST /brand-intelligence/brands
   * Ajouter une marque manuellement
   */
  @Post('brands')
  async addBrand(
    @Body() body: { name: string; category?: string }
  ) {
    const brand = await this.brandService.addBrand(
      body.name,
      body.category || 'autres',
      'manual'
    );
    return {
      success: true,
      message: `Marque "${brand.name}" ajoutée`,
      data: brand,
    };
  }

  /**
   * PUT /brand-intelligence/brands/:name/category
   * Changer la catégorie d'une marque
   */
  @Put('brands/:name/category')
  async updateBrandCategory(
    @Param('name') name: string,
    @Body() body: { category: string }
  ) {
    const updated = await this.brandService.updateBrandCategory(name, body.category);
    return {
      success: updated,
      message: updated ? 'Catégorie mise à jour' : 'Marque non trouvée',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DÉTECTION ET ANALYSE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /brand-intelligence/detect
   * Détecter les marques dans un texte
   */
  @Post('detect')
  detectBrands(@Body() body: { text: string }) {
    const brands = this.brandService.detectBrands(body.text);
    return {
      success: true,
      detectedCount: brands.length,
      data: brands,
    };
  }

  /**
   * POST /brand-intelligence/analyze
   * Analyser une demande complète
   */
  @Post('analyze')
  analyzeRequest(
    @Body() body: {
      items: Array<{ description: string; partNumber?: string; brand?: string }>;
      additionalText?: string;
    }
  ) {
    const result = this.brandService.analyzeRequest(
      body.items,
      body.additionalText
    );
    return {
      success: true,
      data: result,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOURNISSEURS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /brand-intelligence/suppliers/:email
   * Marques associées à un fournisseur
   */
  @Get('suppliers/:email')
  getSupplierBrands(@Param('email') email: string) {
    const relations = this.brandService.getBrandsBySupplier(email);
    return {
      success: true,
      supplier: email,
      brandsCount: relations.length,
      data: relations.map(r => ({
        brand: r.brandName,
        reliability: r.reliability,
        quotesCount: r.quotesCount,
        successfulQuotes: r.successfulQuotes,
        declinedCount: r.declinedCount,
        isPreferred: r.isPreferred,
        lastQuoteAt: r.lastQuoteAt,
      })),
    };
  }

  /**
   * POST /brand-intelligence/suppliers/record
   * Enregistrer une réponse fournisseur
   */
  @Post('suppliers/record')
  async recordSupplierResponse(
    @Body() body: {
      supplierEmail: string;
      supplierName?: string;
      brands: string[];
      isQuote: boolean;
      hasPrice?: boolean;
    }
  ) {
    await this.brandService.recordSupplierResponse(
      body.supplierEmail,
      body.supplierName,
      body.brands,
      body.isQuote,
      body.hasPrice ?? true
    );
    return {
      success: true,
      message: `Relation enregistrée: ${body.supplierEmail} -> ${body.brands.join(', ')}`,
    };
  }

  /**
   * GET /brand-intelligence/suggestions?brands=A,B,C
   * Obtenir les fournisseurs suggérés pour des marques
   */
  @Get('suggestions')
  getSuggestedSuppliers(@Query('brands') brandsParam: string) {
    const brands = (brandsParam || '').split(',').filter(b => b.trim());
    if (brands.length === 0) {
      return { success: false, error: 'Paramètre "brands" requis' };
    }

    const suggestions = this.brandService.getSuggestedSuppliers(brands);
    return {
      success: true,
      brands,
      count: suggestions.length,
      data: suggestions,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION ENVOI AUTOMATIQUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /brand-intelligence/auto-send/config
   * Configuration d'envoi automatique
   */
  @Get('auto-send/config')
  getAutoSendConfig() {
    return {
      success: true,
      data: this.brandService.getAutoSendConfig(),
    };
  }

  /**
   * PUT /brand-intelligence/auto-send/config
   * Mettre à jour la configuration
   */
  @Put('auto-send/config')
  async updateAutoSendConfig(@Body() config: Partial<AutoSendConfig>) {
    const updated = await this.brandService.updateAutoSendConfig(config);
    return {
      success: true,
      message: 'Configuration mise à jour',
      data: updated,
    };
  }
}
