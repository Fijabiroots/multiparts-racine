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
exports.RfqLifecycleController = void 0;
const common_1 = require("@nestjs/common");
const fs = require("fs");
const rfq_lifecycle_service_1 = require("./rfq-lifecycle.service");
const quote_comparison_service_1 = require("./quote-comparison.service");
const reminder_service_1 = require("./reminder.service");
const inbound_scanner_service_1 = require("./inbound-scanner.service");
let RfqLifecycleController = class RfqLifecycleController {
    constructor(lifecycleService, comparisonService, reminderService, inboundService) {
        this.lifecycleService = lifecycleService;
        this.comparisonService = comparisonService;
        this.reminderService = reminderService;
        this.inboundService = inboundService;
    }
    getSentRfqs() {
        const rfqs = this.lifecycleService.getSentRfqs();
        return {
            success: true,
            count: rfqs.length,
            data: rfqs.map(rfq => ({
                ...rfq,
                supplierCount: rfq.suppliers.length,
                respondedCount: rfq.suppliers.filter(s => s.status === 'offre_reçue').length,
                declinedCount: rfq.suppliers.filter(s => s.status === 'refus').length,
            })),
        };
    }
    getRfqDetail(rfqNumber) {
        const rfq = this.lifecycleService.getRfqByNumber(rfqNumber);
        if (!rfq) {
            return { success: false, error: 'RFQ non trouvé' };
        }
        const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
        return {
            success: true,
            data: {
                ...rfq,
                quotes: quotes.map(q => ({
                    supplierEmail: q.supplierEmail,
                    supplierName: q.supplierName,
                    receivedAt: q.receivedAt,
                    totalAmount: q.totalAmount,
                    currency: q.currency,
                    deliveryTime: q.deliveryTime,
                    itemCount: q.items.length,
                    needsManualReview: q.needsManualReview,
                })),
            },
        };
    }
    async scanSentEmails() {
        const newRfqs = await this.lifecycleService.scanSentEmails();
        return {
            success: true,
            message: `${newRfqs.length} nouvelle(s) demande(s) détectée(s)`,
            data: newRfqs,
        };
    }
    async scanInbox() {
        const result = await this.inboundService.scanInboundEmails();
        return {
            success: true,
            message: `Scan terminé: ${result.quotes} offre(s), ${result.declines} refus`,
            data: result,
        };
    }
    getQuotes(rfqNumber) {
        const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
        return {
            success: true,
            count: quotes.length,
            data: quotes,
        };
    }
    async generateComparison(rfqNumber) {
        const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
        if (quotes.length === 0) {
            return { success: false, error: 'Aucune offre reçue pour ce RFQ' };
        }
        const comparison = await this.comparisonService.generateComparisonTable(rfqNumber, quotes);
        return {
            success: true,
            data: {
                rfqNumber: comparison.rfqNumber,
                itemCount: comparison.items.length,
                supplierCount: comparison.suppliers.length,
                recommendation: comparison.recommendation,
                filePath: comparison.filePath,
            },
        };
    }
    async downloadComparison(rfqNumber, res) {
        const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
        if (quotes.length === 0) {
            return res.status(404).json({ success: false, error: 'Aucune offre' });
        }
        const comparison = await this.comparisonService.generateComparisonTable(rfqNumber, quotes);
        if (!comparison.filePath || !fs.existsSync(comparison.filePath)) {
            return res.status(404).json({ success: false, error: 'Fichier non trouvé' });
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="comparatif-${rfqNumber}.xlsx"`);
        fs.createReadStream(comparison.filePath).pipe(res);
    }
    getReminderStatus() {
        const status = this.reminderService.getReminderStatus();
        return {
            success: true,
            data: status,
        };
    }
    async processReminders() {
        const results = await this.reminderService.processReminders();
        return {
            success: true,
            data: {
                total: results.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                details: results,
            },
        };
    }
    async sendManualReminder(rfqNumber, supplierEmail) {
        if (!rfqNumber || !supplierEmail) {
            return { success: false, error: 'rfqNumber et supplierEmail requis' };
        }
        const success = await this.reminderService.sendManualReminder(rfqNumber, supplierEmail);
        return {
            success,
            message: success ? 'Relance envoyée' : 'Échec de l\'envoi',
        };
    }
    getAllSuppliers() {
        const rfqs = this.lifecycleService.getSentRfqs();
        const supplierMap = new Map();
        for (const rfq of rfqs) {
            for (const supplier of rfq.suppliers) {
                const existing = supplierMap.get(supplier.email) || {
                    email: supplier.email,
                    name: supplier.name,
                    rfqCount: 0,
                    quotesReceived: 0,
                    declines: 0,
                    pending: 0,
                };
                existing.rfqCount++;
                if (supplier.status === 'offre_reçue')
                    existing.quotesReceived++;
                if (supplier.status === 'refus')
                    existing.declines++;
                if (supplier.status === 'consulté' || supplier.status === 'relancé')
                    existing.pending++;
                supplierMap.set(supplier.email, existing);
            }
        }
        return {
            success: true,
            count: supplierMap.size,
            data: Array.from(supplierMap.values()),
        };
    }
    getDashboard() {
        const rfqs = this.lifecycleService.getSentRfqs();
        const reminderStatus = this.reminderService.getReminderStatus();
        const stats = {
            totalRfqs: rfqs.length,
            byStatus: {
                envoyé: rfqs.filter(r => r.status === 'envoyé').length,
                en_attente: rfqs.filter(r => r.status === 'en_attente').length,
                partiellement_répondu: rfqs.filter(r => r.status === 'partiellement_répondu').length,
                complet: rfqs.filter(r => r.status === 'complet').length,
                clôturé: rfqs.filter(r => r.status === 'clôturé').length,
            },
            totalSuppliers: 0,
            suppliersWithQuotes: 0,
            suppliersDeclined: 0,
            suppliersPending: 0,
            pendingReminders: reminderStatus.pendingReminders,
            remindersSentToday: reminderStatus.sentToday,
        };
        for (const rfq of rfqs) {
            stats.totalSuppliers += rfq.suppliers.length;
            for (const s of rfq.suppliers) {
                if (s.status === 'offre_reçue')
                    stats.suppliersWithQuotes++;
                if (s.status === 'refus')
                    stats.suppliersDeclined++;
                if (s.status === 'consulté' || s.status === 'relancé')
                    stats.suppliersPending++;
            }
        }
        return {
            success: true,
            data: stats,
        };
    }
};
exports.RfqLifecycleController = RfqLifecycleController;
__decorate([
    (0, common_1.Get)('sent'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getSentRfqs", null);
__decorate([
    (0, common_1.Get)('sent/:rfqNumber'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getRfqDetail", null);
__decorate([
    (0, common_1.Post)('scan-sent'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "scanSentEmails", null);
__decorate([
    (0, common_1.Post)('scan-inbox'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "scanInbox", null);
__decorate([
    (0, common_1.Get)('quotes/:rfqNumber'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getQuotes", null);
__decorate([
    (0, common_1.Post)('comparison/:rfqNumber'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "generateComparison", null);
__decorate([
    (0, common_1.Get)('comparison/:rfqNumber/download'),
    __param(0, (0, common_1.Param)('rfqNumber')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "downloadComparison", null);
__decorate([
    (0, common_1.Get)('reminders/status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getReminderStatus", null);
__decorate([
    (0, common_1.Post)('reminders/process'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "processReminders", null);
__decorate([
    (0, common_1.Post)('reminders/send'),
    __param(0, (0, common_1.Query)('rfqNumber')),
    __param(1, (0, common_1.Query)('supplierEmail')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RfqLifecycleController.prototype, "sendManualReminder", null);
__decorate([
    (0, common_1.Get)('suppliers'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getAllSuppliers", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RfqLifecycleController.prototype, "getDashboard", null);
exports.RfqLifecycleController = RfqLifecycleController = __decorate([
    (0, common_1.Controller)('rfq-lifecycle'),
    __metadata("design:paramtypes", [rfq_lifecycle_service_1.RfqLifecycleService,
        quote_comparison_service_1.QuoteComparisonService,
        reminder_service_1.ReminderService,
        inbound_scanner_service_1.InboundScannerService])
], RfqLifecycleController);
//# sourceMappingURL=rfq-lifecycle.controller.js.map