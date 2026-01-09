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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrandIntelligenceController = void 0;
const common_1 = require("@nestjs/common");
const brand_intelligence_service_1 = require("./brand-intelligence.service");
let BrandIntelligenceController = class BrandIntelligenceController {
    constructor(brandService) {
        this.brandService = brandService;
    }
    getStatistics() {
        return {
            success: true,
            data: this.brandService.getStatistics(),
        };
    }
    getCategories() {
        return {
            success: true,
            data: this.brandService.getCategories(),
        };
    }
    searchBrands(query, limit) {
        const results = this.brandService.searchBrands(query || '', limit ? parseInt(limit, 10) : 20);
        return {
            success: true,
            query,
            count: results.length,
            data: results,
        };
    }
    getBrandsByCategory(categoryKey) {
        const brands = this.brandService.getBrandsByCategory(categoryKey);
        return {
            success: true,
            category: categoryKey,
            count: brands.length,
            data: brands,
        };
    }
    getBrandDetail(name) {
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
    async addBrand(body) {
        const brand = await this.brandService.addBrand(body.name, body.category || 'autres', 'manual');
        return {
            success: true,
            message: `Marque "${brand.name}" ajoutée`,
            data: brand,
        };
    }
    async updateBrandCategory(name, body) {
        const updated = await this.brandService.updateBrandCategory(name, body.category);
        return {
            success: updated,
            message: updated ? 'Catégorie mise à jour' : 'Marque non trouvée',
        };
    }
    detectBrands(body) {
        const brands = this.brandService.detectBrands(body.text);
        return {
            success: true,
            detectedCount: brands.length,
            data: brands,
        };
    }
    analyzeRequest(body) {
        const result = this.brandService.analyzeRequest(body.items, body.additionalText);
        return {
            success: true,
            data: result,
        };
    }
    getSupplierBrands(email) {
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
    async recordSupplierResponse(body) {
        await this.brandService.recordSupplierResponse(body.supplierEmail, body.supplierName, body.brands, body.isQuote, body.hasPrice ?? true);
        return {
            success: true,
            message: `Relation enregistrée: ${body.supplierEmail} -> ${body.brands.join(', ')}`,
        };
    }
    getSuggestedSuppliers(brandsParam) {
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
    getAutoSendConfig() {
        return {
            success: true,
            data: this.brandService.getAutoSendConfig(),
        };
    }
    async updateAutoSendConfig(config) {
        const updated = await this.brandService.updateAutoSendConfig(config);
        return {
            success: true,
            message: 'Configuration mise à jour',
            data: updated,
        };
    }
};
exports.BrandIntelligenceController = BrandIntelligenceController;
__decorate([
    (0, common_1.Get)('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getStatistics", null);
__decorate([
    (0, common_1.Get)('categories'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getCategories", null);
__decorate([
    (0, common_1.Get)('brands/search'),
    __param(0, (0, common_1.Query)('q')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "searchBrands", null);
__decorate([
    (0, common_1.Get)('brands/category/:key'),
    __param(0, (0, common_1.Param)('key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getBrandsByCategory", null);
__decorate([
    (0, common_1.Get)('brands/:name'),
    __param(0, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getBrandDetail", null);
__decorate([
    (0, common_1.Post)('brands'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BrandIntelligenceController.prototype, "addBrand", null);
__decorate([
    (0, common_1.Put)('brands/:name/category'),
    __param(0, (0, common_1.Param)('name')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BrandIntelligenceController.prototype, "updateBrandCategory", null);
__decorate([
    (0, common_1.Post)('detect'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "detectBrands", null);
__decorate([
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "analyzeRequest", null);
__decorate([
    (0, common_1.Get)('suppliers/:email'),
    __param(0, (0, common_1.Param)('email')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getSupplierBrands", null);
__decorate([
    (0, common_1.Post)('suppliers/record'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BrandIntelligenceController.prototype, "recordSupplierResponse", null);
__decorate([
    (0, common_1.Get)('suggestions'),
    __param(0, (0, common_1.Query)('brands')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getSuggestedSuppliers", null);
__decorate([
    (0, common_1.Get)('auto-send/config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BrandIntelligenceController.prototype, "getAutoSendConfig", null);
__decorate([
    (0, common_1.Put)('auto-send/config'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BrandIntelligenceController.prototype, "updateAutoSendConfig", null);
exports.BrandIntelligenceController = BrandIntelligenceController = __decorate([
    (0, common_1.Controller)('brand-intelligence'),
    __metadata("design:paramtypes", [brand_intelligence_service_1.BrandIntelligenceService])
], BrandIntelligenceController);
//# sourceMappingURL=brand-intelligence.controller.js.map