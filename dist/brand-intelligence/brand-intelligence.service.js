"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BrandIntelligenceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrandIntelligenceService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs = require("fs");
const path = require("path");
const brand_interface_1 = require("./brand.interface");
let BrandIntelligenceService = BrandIntelligenceService_1 = class BrandIntelligenceService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(BrandIntelligenceService_1.name);
        this.brandIndex = new Map();
        this.brandAliasIndex = new Map();
        this.supplierBrandIndex = new Map();
        this.brandSupplierIndex = new Map();
        const dataDir = this.configService.get('app.outputDir', './output');
        this.dataFilePath = path.join(dataDir, 'brand-intelligence.json');
    }
    async onModuleInit() {
        await this.loadDatabase();
        this.logger.log(`🧠 Brand Intelligence: ${this.database.brands.length} marques, ${this.database.supplierRelations.length} relations`);
    }
    async loadDatabase() {
        if (fs.existsSync(this.dataFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
                this.database = {
                    ...data,
                    lastUpdated: new Date(data.lastUpdated),
                    brands: data.brands.map((b) => ({
                        ...b,
                        createdAt: new Date(b.createdAt),
                        updatedAt: new Date(b.updatedAt),
                    })),
                    supplierRelations: (data.supplierRelations || []).map((r) => ({
                        ...r,
                        firstContactAt: new Date(r.firstContactAt),
                        updatedAt: new Date(r.updatedAt),
                        lastQuoteAt: r.lastQuoteAt ? new Date(r.lastQuoteAt) : undefined,
                        lastDeclineAt: r.lastDeclineAt ? new Date(r.lastDeclineAt) : undefined,
                    })),
                };
                this.logger.log(`Base de données chargée: ${this.database.brands.length} marques`);
            }
            catch (error) {
                this.logger.warn(`Erreur chargement base: ${error.message}, initialisation...`);
                await this.initializeDatabase();
            }
        }
        else {
            await this.initializeDatabase();
        }
        this.rebuildIndexes();
    }
    async initializeDatabase() {
        const possiblePaths = [
            '/mnt/user-data/uploads/brands_grouped_by_category.json',
            path.join(process.cwd(), 'data', 'brands_grouped_by_category.json'),
            path.join(__dirname, '..', '..', 'data', 'brands_grouped_by_category.json'),
        ];
        let sourceData = null;
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
            categories: brand_interface_1.DEFAULT_CATEGORIES,
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
        if (sourceData?.categories) {
            for (const cat of sourceData.categories) {
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
    rebuildIndexes() {
        this.brandIndex.clear();
        this.brandAliasIndex.clear();
        this.supplierBrandIndex.clear();
        this.brandSupplierIndex.clear();
        for (const brand of this.database.brands) {
            this.brandIndex.set(brand.normalizedName, brand);
            if (brand.aliases) {
                for (const alias of brand.aliases) {
                    this.brandAliasIndex.set(this.normalizeName(alias), brand.name);
                }
            }
        }
        this.addCommonAliases();
        for (const rel of this.database.supplierRelations) {
            if (!this.supplierBrandIndex.has(rel.supplierEmail)) {
                this.supplierBrandIndex.set(rel.supplierEmail, []);
            }
            this.supplierBrandIndex.get(rel.supplierEmail).push(rel);
            if (!this.brandSupplierIndex.has(rel.brandName)) {
                this.brandSupplierIndex.set(rel.brandName, []);
            }
            this.brandSupplierIndex.get(rel.brandName).push(rel);
        }
    }
    addCommonAliases() {
        const commonAliases = {
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
    normalizeName(name) {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }
    async saveDatabase() {
        this.database.lastUpdated = new Date();
        const dir = path.dirname(this.dataFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.dataFilePath, JSON.stringify(this.database, null, 2));
    }
    detectBrands(text) {
        const detectedBrands = new Set();
        const normalizedText = text.toLowerCase();
        const words = text.split(/[\s,;:\-\/\(\)\[\]]+/);
        for (const [normalizedName, brand] of this.brandIndex) {
            if (normalizedText.includes(normalizedName) ||
                normalizedText.includes(brand.name.toLowerCase())) {
                detectedBrands.add(brand.name);
            }
        }
        for (const [alias, brandName] of this.brandAliasIndex) {
            if (normalizedText.includes(alias)) {
                detectedBrands.add(brandName);
            }
        }
        for (const word of words) {
            if (word.length < 3)
                continue;
            const normalized = this.normalizeName(word);
            if (this.brandIndex.has(normalized)) {
                detectedBrands.add(this.brandIndex.get(normalized).name);
            }
            if (this.brandAliasIndex.has(normalized)) {
                detectedBrands.add(this.brandAliasIndex.get(normalized));
            }
        }
        const partNumberPatterns = [
            /(?:p\/n|part|ref|reference)[:\s]*([A-Z]{2,}[-\s]?\d+)/gi,
            /\b([A-Z]{3,})[-]?\d{3,}/g,
        ];
        for (const pattern of partNumberPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const prefix = match[1]?.substring(0, 3).toLowerCase();
                if (prefix && this.brandAliasIndex.has(prefix)) {
                    detectedBrands.add(this.brandAliasIndex.get(prefix));
                }
            }
        }
        return Array.from(detectedBrands);
    }
    analyzeRequest(items, additionalText) {
        const allBrands = new Set();
        const newBrands = [];
        for (const item of items) {
            const textToAnalyze = [
                item.description,
                item.partNumber || '',
                item.brand || '',
            ].join(' ');
            const detected = this.detectBrands(textToAnalyze);
            detected.forEach(b => allBrands.add(b));
            if (item.brand && !this.brandIndex.has(this.normalizeName(item.brand))) {
                const normalizedBrand = item.brand.trim();
                if (normalizedBrand.length >= 2 && !newBrands.includes(normalizedBrand)) {
                    newBrands.push(normalizedBrand);
                }
            }
        }
        if (additionalText) {
            const detected = this.detectBrands(additionalText);
            detected.forEach(b => allBrands.add(b));
        }
        const suggestedSuppliers = this.getSuggestedSuppliers(Array.from(allBrands));
        const { autoSend, manualReview } = this.categorizeSuppliers(suggestedSuppliers);
        return {
            detectedBrands: Array.from(allBrands),
            newBrands,
            suggestedSuppliers,
            autoSendEmails: autoSend,
            manualReviewEmails: manualReview,
        };
    }
    getSuggestedSuppliers(brands) {
        const suggestions = [];
        const seenEmails = new Set();
        for (const brandName of brands) {
            const relations = this.brandSupplierIndex.get(brandName) || [];
            const brand = this.brandIndex.get(this.normalizeName(brandName));
            const category = brand?.category || 'autres';
            for (const rel of relations) {
                if (seenEmails.has(rel.supplierEmail))
                    continue;
                seenEmails.add(rel.supplierEmail);
                const reasons = [];
                if (rel.isPreferred)
                    reasons.push('Fournisseur préféré');
                if (rel.quotesCount > 5)
                    reasons.push(`${rel.quotesCount} devis reçus`);
                if (rel.reliability >= 80)
                    reasons.push('Haute fiabilité');
                if (rel.successfulQuotes > 0)
                    reasons.push('A déjà fourni cette marque');
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
        return suggestions.sort((a, b) => b.reliability - a.reliability);
    }
    categorizeSuppliers(suggestions) {
        const config = this.database.autoSendConfig;
        const autoSend = [];
        const manualReview = [];
        const brandCounts = new Map();
        if (!config.enabled) {
            return { autoSend: [], manualReview: suggestions.map(s => s.email) };
        }
        for (const suggestion of suggestions) {
            const count = brandCounts.get(suggestion.brand) || 0;
            if (count >= config.maxSuppliersPerBrand) {
                continue;
            }
            if (suggestion.reliability >= config.minReliability) {
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
            }
            else {
                manualReview.push(suggestion.email);
            }
        }
        return { autoSend: [...new Set(autoSend)], manualReview: [...new Set(manualReview)] };
    }
    getRelation(email, brandName) {
        const relations = this.supplierBrandIndex.get(email) || [];
        return relations.find(r => r.brandName === brandName);
    }
    async recordSupplierResponse(supplierEmail, supplierName, brands, isQuote, hasPrice = true) {
        const now = new Date();
        for (const brandName of brands) {
            let relation = this.getRelation(supplierEmail, brandName);
            if (!relation) {
                relation = {
                    supplierEmail,
                    supplierName,
                    brandName,
                    quotesCount: 0,
                    successfulQuotes: 0,
                    declinedCount: 0,
                    reliability: 50,
                    isPreferred: false,
                    firstContactAt: now,
                    updatedAt: now,
                };
                this.database.supplierRelations.push(relation);
                if (!this.supplierBrandIndex.has(supplierEmail)) {
                    this.supplierBrandIndex.set(supplierEmail, []);
                }
                this.supplierBrandIndex.get(supplierEmail).push(relation);
                if (!this.brandSupplierIndex.has(brandName)) {
                    this.brandSupplierIndex.set(brandName, []);
                }
                this.brandSupplierIndex.get(brandName).push(relation);
            }
            relation.updatedAt = now;
            if (supplierName)
                relation.supplierName = supplierName;
            if (isQuote) {
                relation.quotesCount++;
                relation.lastQuoteAt = now;
                if (hasPrice) {
                    relation.successfulQuotes++;
                }
                relation.reliability = Math.min(100, relation.reliability + 5);
            }
            else {
                relation.declinedCount++;
                relation.lastDeclineAt = now;
                relation.reliability = Math.max(10, relation.reliability - 10);
            }
            if (relation.quotesCount > 0) {
                const successRate = relation.successfulQuotes / relation.quotesCount;
                const declineRate = relation.declinedCount / (relation.quotesCount + relation.declinedCount);
                relation.reliability = Math.round((successRate * 100) - (declineRate * 30));
                relation.reliability = Math.max(0, Math.min(100, relation.reliability));
            }
            if (relation.reliability >= 85 && relation.quotesCount >= 3) {
                relation.isPreferred = true;
            }
        }
        await this.saveDatabase();
        this.logger.log(`📊 Relation mise à jour: ${supplierEmail} -> ${brands.join(', ')} (${isQuote ? 'offre' : 'refus'})`);
    }
    async addBrand(name, category = 'autres', source = 'auto_detected') {
        const normalizedName = this.normalizeName(name);
        if (this.brandIndex.has(normalizedName)) {
            return this.brandIndex.get(normalizedName);
        }
        const brand = {
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
    async addNewBrands(brandNames, category = 'autres') {
        const addedBrands = [];
        for (const name of brandNames) {
            if (name.length >= 2) {
                const brand = await this.addBrand(name, category, 'auto_detected');
                addedBrands.push(brand);
            }
        }
        return addedBrands;
    }
    async updateBrandCategory(brandName, newCategory) {
        const brand = this.brandIndex.get(this.normalizeName(brandName));
        if (!brand)
            return false;
        brand.category = newCategory;
        brand.updatedAt = new Date();
        await this.saveDatabase();
        this.logger.log(`🏷️ Catégorie mise à jour: ${brandName} -> ${newCategory}`);
        return true;
    }
    findBrand(name) {
        const normalized = this.normalizeName(name);
        if (this.brandIndex.has(normalized)) {
            return this.brandIndex.get(normalized);
        }
        if (this.brandAliasIndex.has(normalized)) {
            const brandName = this.brandAliasIndex.get(normalized);
            return this.brandIndex.get(this.normalizeName(brandName));
        }
        return undefined;
    }
    getBrandsByCategory(categoryKey) {
        return this.database.brands.filter(b => b.category === categoryKey);
    }
    getStatistics() {
        const categoryStats = new Map();
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
    getAutoSendConfig() {
        return { ...this.database.autoSendConfig };
    }
    async updateAutoSendConfig(config) {
        this.database.autoSendConfig = {
            ...this.database.autoSendConfig,
            ...config,
        };
        await this.saveDatabase();
        return this.database.autoSendConfig;
    }
    getCategories() {
        return this.database.categories;
    }
    searchBrands(query, limit = 20) {
        const normalized = this.normalizeName(query);
        const results = [];
        for (const brand of this.database.brands) {
            if (brand.normalizedName.includes(normalized) ||
                brand.name.toLowerCase().includes(query.toLowerCase())) {
                results.push(brand);
                if (results.length >= limit)
                    break;
            }
        }
        return results;
    }
    getSuppliersByBrand(brandName) {
        return this.brandSupplierIndex.get(brandName) || [];
    }
    getBrandsBySupplier(email) {
        return this.supplierBrandIndex.get(email) || [];
    }
};
exports.BrandIntelligenceService = BrandIntelligenceService;
exports.BrandIntelligenceService = BrandIntelligenceService = BrandIntelligenceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], BrandIntelligenceService);
//# sourceMappingURL=brand-intelligence.service.js.map