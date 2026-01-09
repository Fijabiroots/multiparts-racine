import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  Brand,
  BrandCategory,
  BrandDatabase,
  SupplierBrandRelation,
  SupplierSuggestion,
  BrandAnalysisResult,
  AutoSendConfig,
  DEFAULT_CATEGORIES,
} from './brand.interface';

@Injectable()
export class BrandIntelligenceService implements OnModuleInit {
  private readonly logger = new Logger(BrandIntelligenceService.name);
  private readonly dataFilePath: string;
  
  private database: BrandDatabase;
  private brandIndex: Map<string, Brand> = new Map();  // normalizedName -> Brand
  private brandAliasIndex: Map<string, string> = new Map();  // alias -> brandName
  private supplierBrandIndex: Map<string, SupplierBrandRelation[]> = new Map();  // email -> relations
  private brandSupplierIndex: Map<string, SupplierBrandRelation[]> = new Map();  // brandName -> relations

  constructor(private configService: ConfigService) {
    const dataDir = this.configService.get<string>('app.outputDir', './output');
    this.dataFilePath = path.join(dataDir, 'brand-intelligence.json');
  }

  async onModuleInit() {
    await this.loadDatabase();
    this.logger.log(`🧠 Brand Intelligence: ${this.database.brands.length} marques, ${this.database.supplierRelations.length} relations`);
  }

  /**
   * Charger ou initialiser la base de données
   */
  private async loadDatabase(): Promise<void> {
    if (fs.existsSync(this.dataFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
        this.database = {
          ...data,
          lastUpdated: new Date(data.lastUpdated),
          brands: data.brands.map((b: any) => ({
            ...b,
            createdAt: new Date(b.createdAt),
            updatedAt: new Date(b.updatedAt),
          })),
          supplierRelations: (data.supplierRelations || []).map((r: any) => ({
            ...r,
            firstContactAt: new Date(r.firstContactAt),
            updatedAt: new Date(r.updatedAt),
            lastQuoteAt: r.lastQuoteAt ? new Date(r.lastQuoteAt) : undefined,
            lastDeclineAt: r.lastDeclineAt ? new Date(r.lastDeclineAt) : undefined,
          })),
        };
        this.logger.log(`Base de données chargée: ${this.database.brands.length} marques`);
      } catch (error) {
        this.logger.warn(`Erreur chargement base: ${error.message}, initialisation...`);
        await this.initializeDatabase();
      }
    } else {
      await this.initializeDatabase();
    }
    
    this.rebuildIndexes();
  }

  /**
   * Initialiser avec le fichier JSON fourni
   */
  private async initializeDatabase(): Promise<void> {
    // Chercher le fichier source dans plusieurs emplacements
    const possiblePaths = [
      '/mnt/user-data/uploads/brands_grouped_by_category.json',
      path.join(process.cwd(), 'data', 'brands_grouped_by_category.json'),
      path.join(__dirname, '..', '..', 'data', 'brands_grouped_by_category.json'),
    ];
    
    let sourceData: any = null;
    for (const sourcePath of possiblePaths) {
      if (fs.existsSync(sourcePath)) {
        sourceData = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
        this.logger.log(`Fichier source trouvé: ${sourcePath} (${sourceData.total_unique_brands} marques)`);
        break;
      }
    }

    this.database = {
      version: '1.0',
      lastUpdated: new Date(),
      categories: DEFAULT_CATEGORIES,
      brands: [],
      supplierRelations: [],
      autoSendConfig: {
        enabled: true,
        minReliability: 50,
        maxSuppliersPerBrand: 5,
        excludeDeclined: true,
        declineCooldownDays: 30,
      },
    };

    // Importer les marques du fichier source
    if (sourceData?.categories) {
      for (const cat of sourceData.categories) {
        // Mapper la catégorie
        let categoryKey = cat.key;
        if (!this.database.categories.find(c => c.key === categoryKey)) {
          categoryKey = 'autres';
        }

        for (const brandName of cat.brands || []) {
          this.database.brands.push({
            name: brandName,
            normalizedName: this.normalizeName(brandName),
            category: categoryKey,
            createdAt: new Date(),
            updatedAt: new Date(),
            source: 'initial',
          });
        }
      }
    }

    await this.saveDatabase();
    this.logger.log(`Base initialisée avec ${this.database.brands.length} marques`);
  }

  /**
   * Reconstruire les index pour recherche rapide
   */
  private rebuildIndexes(): void {
    this.brandIndex.clear();
    this.brandAliasIndex.clear();
    this.supplierBrandIndex.clear();
    this.brandSupplierIndex.clear();

    // Index des marques
    for (const brand of this.database.brands) {
      this.brandIndex.set(brand.normalizedName, brand);
      
      // Ajouter des alias courants
      if (brand.aliases) {
        for (const alias of brand.aliases) {
          this.brandAliasIndex.set(this.normalizeName(alias), brand.name);
        }
      }
    }

    // Ajouter des alias courants automatiques
    this.addCommonAliases();

    // Index des relations
    for (const rel of this.database.supplierRelations) {
      // Par fournisseur
      if (!this.supplierBrandIndex.has(rel.supplierEmail)) {
        this.supplierBrandIndex.set(rel.supplierEmail, []);
      }
      this.supplierBrandIndex.get(rel.supplierEmail)!.push(rel);

      // Par marque
      if (!this.brandSupplierIndex.has(rel.brandName)) {
        this.brandSupplierIndex.set(rel.brandName, []);
      }
      this.brandSupplierIndex.get(rel.brandName)!.push(rel);
    }
  }

  /**
   * Ajouter des alias courants
   */
  private addCommonAliases(): void {
    const commonAliases: Record<string, string[]> = {
      'Caterpillar': ['CAT', 'CATERPILLAR INC'],
      'SKF': ['SKF GROUP', 'SKF AB'],
      'Parker': ['PARKER HANNIFIN', 'PARKER-HANNIFIN'],
      'Siemens': ['SIEMENS AG'],
      'ABB': ['ABB LTD', 'ASEA BROWN BOVERI'],
      'Bosch Rexroth': ['REXROTH', 'BOSCH-REXROTH'],
      'Schneider Electric': ['SCHNEIDER', 'TELEMECANIQUE'],
      'Emerson': ['EMERSON ELECTRIC', 'EMERSON PROCESS'],
      'Eaton': ['EATON CORP', 'EATON CORPORATION'],
      'Danfoss': ['DANFOSS A/S'],
      'Grundfos': ['GRUNDFOS PUMPS'],
      'Flowserve': ['FLOWSERVE CORP'],
      'Timken': ['THE TIMKEN COMPANY'],
      'NSK': ['NSK LTD'],
      'FAG': ['FAG BEARINGS', 'SCHAEFFLER FAG'],
      'Cummins': ['CUMMINS INC', 'CUMMINS ENGINE'],
      'Perkins': ['PERKINS ENGINES'],
      'Komatsu': ['KOMATSU LTD'],
      'Hitachi': ['HITACHI LTD', 'HITACHI CONSTRUCTION'],
      'Liebherr': ['LIEBHERR GROUP'],
      'ZF Friedrichshafen': ['ZF', 'ZF GROUP'],
      '3M': ['3M COMPANY', 'MINNESOTA MINING'],
    };

    for (const [brand, aliases] of Object.entries(commonAliases)) {
      if (this.brandIndex.has(this.normalizeName(brand))) {
        for (const alias of aliases) {
          this.brandAliasIndex.set(this.normalizeName(alias), brand);
        }
      }
    }
  }

  /**
   * Normaliser un nom pour la recherche
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // Retirer accents
      .replace(/[^a-z0-9]/g, '')        // Garder que alphanumériques
      .trim();
  }

  /**
   * Sauvegarder la base de données
   */
  private async saveDatabase(): Promise<void> {
    this.database.lastUpdated = new Date();
    
    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(this.dataFilePath, JSON.stringify(this.database, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DÉTECTION DE MARQUES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Détecter les marques dans un texte
   */
  detectBrands(text: string): string[] {
    const detectedBrands = new Set<string>();
    const normalizedText = text.toLowerCase();
    const words = text.split(/[\s,;:\-\/\(\)\[\]]+/);

    // Recherche par nom exact et alias
    for (const [normalizedName, brand] of this.brandIndex) {
      // Vérifier si le nom normalisé est dans le texte
      if (normalizedText.includes(normalizedName) || 
          normalizedText.includes(brand.name.toLowerCase())) {
        detectedBrands.add(brand.name);
      }
    }

    // Recherche par alias
    for (const [alias, brandName] of this.brandAliasIndex) {
      if (normalizedText.includes(alias)) {
        detectedBrands.add(brandName);
      }
    }

    // Recherche par mots individuels (pour marques à un mot)
    for (const word of words) {
      if (word.length < 3) continue;
      const normalized = this.normalizeName(word);
      
      if (this.brandIndex.has(normalized)) {
        detectedBrands.add(this.brandIndex.get(normalized)!.name);
      }
      if (this.brandAliasIndex.has(normalized)) {
        detectedBrands.add(this.brandAliasIndex.get(normalized)!);
      }
    }

    // Recherche patterns spéciaux (ex: "P/N CAT-1234" -> Caterpillar)
    const partNumberPatterns = [
      /(?:p\/n|part|ref|reference)[:\s]*([A-Z]{2,}[-\s]?\d+)/gi,
      /\b([A-Z]{3,})[-]?\d{3,}/g,
    ];

    for (const pattern of partNumberPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const prefix = match[1]?.substring(0, 3).toLowerCase();
        if (prefix && this.brandAliasIndex.has(prefix)) {
          detectedBrands.add(this.brandAliasIndex.get(prefix)!);
        }
      }
    }

    return Array.from(detectedBrands);
  }

  /**
   * Analyser une demande complète
   */
  analyzeRequest(
    items: Array<{ description: string; partNumber?: string; brand?: string }>,
    additionalText?: string
  ): BrandAnalysisResult {
    const allBrands = new Set<string>();
    const newBrands: string[] = [];

    // Détecter dans les items
    for (const item of items) {
      const textToAnalyze = [
        item.description,
        item.partNumber || '',
        item.brand || '',
      ].join(' ');

      const detected = this.detectBrands(textToAnalyze);
      detected.forEach(b => allBrands.add(b));

      // Vérifier si une marque explicite n'existe pas
      if (item.brand && !this.brandIndex.has(this.normalizeName(item.brand))) {
        const normalizedBrand = item.brand.trim();
        if (normalizedBrand.length >= 2 && !newBrands.includes(normalizedBrand)) {
          newBrands.push(normalizedBrand);
        }
      }
    }

    // Détecter dans le texte additionnel
    if (additionalText) {
      const detected = this.detectBrands(additionalText);
      detected.forEach(b => allBrands.add(b));
    }

    // Trouver les fournisseurs suggérés
    const suggestedSuppliers = this.getSuggestedSuppliers(Array.from(allBrands));
    
    // Déterminer les emails pour envoi automatique
    const { autoSend, manualReview } = this.categorizeSuppliers(suggestedSuppliers);

    return {
      detectedBrands: Array.from(allBrands),
      newBrands,
      suggestedSuppliers,
      autoSendEmails: autoSend,
      manualReviewEmails: manualReview,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GESTION DES RELATIONS FOURNISSEUR-MARQUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtenir les fournisseurs suggérés pour des marques
   */
  getSuggestedSuppliers(brands: string[]): SupplierSuggestion[] {
    const suggestions: SupplierSuggestion[] = [];
    const seenEmails = new Set<string>();

    for (const brandName of brands) {
      const relations = this.brandSupplierIndex.get(brandName) || [];
      const brand = this.brandIndex.get(this.normalizeName(brandName));
      const category = brand?.category || 'autres';

      for (const rel of relations) {
        if (seenEmails.has(rel.supplierEmail)) continue;
        seenEmails.add(rel.supplierEmail);

        // Calculer la raison de suggestion
        const reasons: string[] = [];
        if (rel.isPreferred) reasons.push('Fournisseur préféré');
        if (rel.quotesCount > 5) reasons.push(`${rel.quotesCount} devis reçus`);
        if (rel.reliability >= 80) reasons.push('Haute fiabilité');
        if (rel.successfulQuotes > 0) reasons.push('A déjà fourni cette marque');

        suggestions.push({
          email: rel.supplierEmail,
          name: rel.supplierName,
          brand: brandName,
          category,
          reliability: rel.reliability,
          quotesCount: rel.quotesCount,
          lastActivity: rel.lastQuoteAt || rel.lastDeclineAt,
          isPreferred: rel.isPreferred,
          reason: reasons.length > 0 ? reasons.join(', ') : 'Connu pour cette marque',
        });
      }
    }

    // Trier par fiabilité décroissante
    return suggestions.sort((a, b) => b.reliability - a.reliability);
  }

  /**
   * Catégoriser les fournisseurs pour envoi auto vs manuel
   */
  private categorizeSuppliers(suggestions: SupplierSuggestion[]): {
    autoSend: string[];
    manualReview: string[];
  } {
    const config = this.database.autoSendConfig;
    const autoSend: string[] = [];
    const manualReview: string[] = [];
    const brandCounts = new Map<string, number>();

    if (!config.enabled) {
      return { autoSend: [], manualReview: suggestions.map(s => s.email) };
    }

    for (const suggestion of suggestions) {
      // Vérifier le nombre max par marque
      const count = brandCounts.get(suggestion.brand) || 0;
      if (count >= config.maxSuppliersPerBrand) {
        continue;
      }

      // Vérifier les critères d'envoi automatique
      if (suggestion.reliability >= config.minReliability) {
        // Vérifier le cooldown de refus
        if (config.excludeDeclined) {
          const rel = this.getRelation(suggestion.email, suggestion.brand);
          if (rel?.lastDeclineAt) {
            const daysSinceDecline = (Date.now() - rel.lastDeclineAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceDecline < config.declineCooldownDays) {
              manualReview.push(suggestion.email);
              continue;
            }
          }
        }

        autoSend.push(suggestion.email);
        brandCounts.set(suggestion.brand, count + 1);
      } else {
        manualReview.push(suggestion.email);
      }
    }

    return { autoSend: [...new Set(autoSend)], manualReview: [...new Set(manualReview)] };
  }

  /**
   * Obtenir une relation spécifique
   */
  private getRelation(email: string, brandName: string): SupplierBrandRelation | undefined {
    const relations = this.supplierBrandIndex.get(email) || [];
    return relations.find(r => r.brandName === brandName);
  }

  /**
   * Enregistrer une réponse fournisseur (offre ou refus)
   */
  async recordSupplierResponse(
    supplierEmail: string,
    supplierName: string | undefined,
    brands: string[],
    isQuote: boolean,  // true = offre, false = refus
    hasPrice: boolean = true
  ): Promise<void> {
    const now = new Date();

    for (const brandName of brands) {
      let relation = this.getRelation(supplierEmail, brandName);

      if (!relation) {
        // Créer nouvelle relation
        relation = {
          supplierEmail,
          supplierName,
          brandName,
          quotesCount: 0,
          successfulQuotes: 0,
          declinedCount: 0,
          reliability: 50,  // Score initial neutre
          isPreferred: false,
          firstContactAt: now,
          updatedAt: now,
        };
        this.database.supplierRelations.push(relation);
        
        // Mettre à jour les index
        if (!this.supplierBrandIndex.has(supplierEmail)) {
          this.supplierBrandIndex.set(supplierEmail, []);
        }
        this.supplierBrandIndex.get(supplierEmail)!.push(relation);
        
        if (!this.brandSupplierIndex.has(brandName)) {
          this.brandSupplierIndex.set(brandName, []);
        }
        this.brandSupplierIndex.get(brandName)!.push(relation);
      }

      // Mettre à jour les stats
      relation.updatedAt = now;
      if (supplierName) relation.supplierName = supplierName;

      if (isQuote) {
        relation.quotesCount++;
        relation.lastQuoteAt = now;
        if (hasPrice) {
          relation.successfulQuotes++;
        }
        // Améliorer la fiabilité
        relation.reliability = Math.min(100, relation.reliability + 5);
      } else {
        // Refus
        relation.declinedCount++;
        relation.lastDeclineAt = now;
        // Diminuer la fiabilité (mais pas en dessous de 10)
        relation.reliability = Math.max(10, relation.reliability - 10);
      }

      // Recalculer la fiabilité globale
      if (relation.quotesCount > 0) {
        const successRate = relation.successfulQuotes / relation.quotesCount;
        const declineRate = relation.declinedCount / (relation.quotesCount + relation.declinedCount);
        relation.reliability = Math.round((successRate * 100) - (declineRate * 30));
        relation.reliability = Math.max(0, Math.min(100, relation.reliability));
      }

      // Marquer comme préféré si très fiable
      if (relation.reliability >= 85 && relation.quotesCount >= 3) {
        relation.isPreferred = true;
      }
    }

    await this.saveDatabase();
    this.logger.log(`📊 Relation mise à jour: ${supplierEmail} -> ${brands.join(', ')} (${isQuote ? 'offre' : 'refus'})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GESTION DES MARQUES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ajouter une nouvelle marque
   */
  async addBrand(
    name: string,
    category: string = 'autres',
    source: 'auto_detected' | 'manual' = 'auto_detected'
  ): Promise<Brand> {
    const normalizedName = this.normalizeName(name);
    
    // Vérifier si existe déjà
    if (this.brandIndex.has(normalizedName)) {
      return this.brandIndex.get(normalizedName)!;
    }

    const brand: Brand = {
      name: name.trim(),
      normalizedName,
      category,
      createdAt: new Date(),
      updatedAt: new Date(),
      source,
    };

    this.database.brands.push(brand);
    this.brandIndex.set(normalizedName, brand);
    
    await this.saveDatabase();
    this.logger.log(`🏷️ Nouvelle marque ajoutée: ${name} (${category})`);
    
    return brand;
  }

  /**
   * Ajouter plusieurs marques automatiquement détectées
   */
  async addNewBrands(brandNames: string[], category: string = 'autres'): Promise<Brand[]> {
    const addedBrands: Brand[] = [];
    
    for (const name of brandNames) {
      if (name.length >= 2) {
        const brand = await this.addBrand(name, category, 'auto_detected');
        addedBrands.push(brand);
      }
    }
    
    return addedBrands;
  }

  /**
   * Mettre à jour la catégorie d'une marque
   */
  async updateBrandCategory(brandName: string, newCategory: string): Promise<boolean> {
    const brand = this.brandIndex.get(this.normalizeName(brandName));
    if (!brand) return false;

    brand.category = newCategory;
    brand.updatedAt = new Date();
    
    await this.saveDatabase();
    this.logger.log(`🏷️ Catégorie mise à jour: ${brandName} -> ${newCategory}`);
    
    return true;
  }

  /**
   * Rechercher une marque
   */
  findBrand(name: string): Brand | undefined {
    const normalized = this.normalizeName(name);
    
    // Recherche directe
    if (this.brandIndex.has(normalized)) {
      return this.brandIndex.get(normalized);
    }
    
    // Recherche par alias
    if (this.brandAliasIndex.has(normalized)) {
      const brandName = this.brandAliasIndex.get(normalized)!;
      return this.brandIndex.get(this.normalizeName(brandName));
    }
    
    return undefined;
  }

  /**
   * Obtenir toutes les marques d'une catégorie
   */
  getBrandsByCategory(categoryKey: string): Brand[] {
    return this.database.brands.filter(b => b.category === categoryKey);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PUBLIQUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Obtenir les statistiques
   */
  getStatistics(): any {
    const categoryStats = new Map<string, number>();
    for (const brand of this.database.brands) {
      categoryStats.set(brand.category, (categoryStats.get(brand.category) || 0) + 1);
    }

    const supplierStats = {
      total: new Set(this.database.supplierRelations.map(r => r.supplierEmail)).size,
      withPreferred: this.database.supplierRelations.filter(r => r.isPreferred).length,
      highReliability: this.database.supplierRelations.filter(r => r.reliability >= 80).length,
    };

    return {
      brands: {
        total: this.database.brands.length,
        byCategory: Object.fromEntries(categoryStats),
        bySource: {
          initial: this.database.brands.filter(b => b.source === 'initial').length,
          autoDetected: this.database.brands.filter(b => b.source === 'auto_detected').length,
          manual: this.database.brands.filter(b => b.source === 'manual').length,
        },
      },
      suppliers: supplierStats,
      relations: {
        total: this.database.supplierRelations.length,
        avgReliability: this.database.supplierRelations.length > 0
          ? Math.round(this.database.supplierRelations.reduce((sum, r) => sum + r.reliability, 0) / this.database.supplierRelations.length)
          : 0,
      },
      autoSendConfig: this.database.autoSendConfig,
      lastUpdated: this.database.lastUpdated,
    };
  }

  /**
   * Obtenir la configuration d'envoi automatique
   */
  getAutoSendConfig(): AutoSendConfig {
    return { ...this.database.autoSendConfig };
  }

  /**
   * Mettre à jour la configuration d'envoi automatique
   */
  async updateAutoSendConfig(config: Partial<AutoSendConfig>): Promise<AutoSendConfig> {
    this.database.autoSendConfig = {
      ...this.database.autoSendConfig,
      ...config,
    };
    await this.saveDatabase();
    return this.database.autoSendConfig;
  }

  /**
   * Obtenir toutes les catégories
   */
  getCategories(): BrandCategory[] {
    return this.database.categories;
  }

  /**
   * Recherche de marques (pour autocomplete)
   */
  searchBrands(query: string, limit: number = 20): Brand[] {
    const normalized = this.normalizeName(query);
    const results: Brand[] = [];

    for (const brand of this.database.brands) {
      if (brand.normalizedName.includes(normalized) || 
          brand.name.toLowerCase().includes(query.toLowerCase())) {
        results.push(brand);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Obtenir les fournisseurs d'une marque
   */
  getSuppliersByBrand(brandName: string): SupplierBrandRelation[] {
    return this.brandSupplierIndex.get(brandName) || [];
  }

  /**
   * Obtenir les marques d'un fournisseur
   */
  getBrandsBySupplier(email: string): SupplierBrandRelation[] {
    return this.supplierBrandIndex.get(email) || [];
  }
}
