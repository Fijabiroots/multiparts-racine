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
var TrackingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
let TrackingService = TrackingService_1 = class TrackingService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(TrackingService_1.name);
        this.workbook = null;
        const outputDir = this.configService.get('app.outputDir', './output');
        this.trackingFilePath = path.join(outputDir, 'suivi-rfq.xlsx');
        this.initializeWorkbook();
    }
    initializeWorkbook() {
        try {
            const dir = path.dirname(this.trackingFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (fs.existsSync(this.trackingFilePath)) {
                this.workbook = XLSX.readFile(this.trackingFilePath);
                this.logger.log(`Fichier de suivi chargé: ${this.trackingFilePath}`);
            }
            else {
                this.workbook = XLSX.utils.book_new();
                this.createIndexSheet();
                this.saveWorkbook();
                this.logger.log(`Nouveau fichier de suivi créé: ${this.trackingFilePath}`);
            }
        }
        catch (error) {
            this.logger.error(`Erreur initialisation fichier de suivi: ${error.message}`);
            this.workbook = XLSX.utils.book_new();
        }
    }
    createIndexSheet() {
        if (!this.workbook)
            return;
        const indexData = [
            ['SUIVI DES DEMANDES DE PRIX - MULTIPARTS CI'],
            [''],
            ['Fichier généré automatiquement par le système de traitement des RFQ'],
            [''],
            ['Instructions:'],
            ['- Une feuille est créée pour chaque jour avec des demandes'],
            ['- Chaque ligne représente une demande de prix traitée'],
            ['- La correspondance RFQ Client ↔ RFQ Interne permet le suivi'],
            [''],
            ['Statistiques globales:'],
            ['Total RFQ traités:', 0],
            ['Dernière mise à jour:', new Date().toLocaleString('fr-FR')],
        ];
        const ws = XLSX.utils.aoa_to_sheet(indexData);
        ws['!cols'] = [{ wch: 60 }];
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
        XLSX.utils.book_append_sheet(this.workbook, ws, 'Index');
    }
    getSheetName(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    getOrCreateDaySheet(date) {
        if (!this.workbook) {
            this.workbook = XLSX.utils.book_new();
        }
        const sheetName = this.getSheetName(date);
        if (this.workbook.SheetNames.includes(sheetName)) {
            return this.workbook.Sheets[sheetName];
        }
        const headers = [
            'Heure',
            'N° RFQ Client',
            'N° RFQ Interne',
            'Client',
            'Email Client',
            'Sujet',
            'Nb Articles',
            'Statut',
            'Accusé Envoyé',
            'Deadline',
            'Notes'
        ];
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        ws['!cols'] = [
            { wch: 10 },
            { wch: 18 },
            { wch: 22 },
            { wch: 25 },
            { wch: 30 },
            { wch: 40 },
            { wch: 12 },
            { wch: 18 },
            { wch: 14 },
            { wch: 20 },
            { wch: 35 },
        ];
        XLSX.utils.book_append_sheet(this.workbook, ws, sheetName);
        this.reorderSheets();
        this.logger.log(`Nouvelle feuille créée pour le ${sheetName}`);
        return ws;
    }
    reorderSheets() {
        if (!this.workbook)
            return;
        const sheetNames = this.workbook.SheetNames;
        const dateSheets = sheetNames
            .filter(name => name !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(name))
            .sort((a, b) => b.localeCompare(a));
        const otherSheets = sheetNames.filter(name => name !== 'Index' && !/^\d{4}-\d{2}-\d{2}$/.test(name));
        const newOrder = ['Index', ...dateSheets, ...otherSheets].filter(name => sheetNames.includes(name));
        if (!sheetNames.includes('Index')) {
            newOrder.shift();
        }
        this.workbook.SheetNames = newOrder;
    }
    async addEntry(entry) {
        try {
            this.reloadWorkbook();
            const ws = this.getOrCreateDaySheet(entry.timestamp);
            const row = [
                entry.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                entry.clientRfqNumber || '-',
                entry.internalRfqNumber,
                entry.clientName || '-',
                entry.clientEmail,
                entry.subject.substring(0, 50) + (entry.subject.length > 50 ? '...' : ''),
                entry.itemCount,
                this.formatStatus(entry.status),
                entry.acknowledgmentSent ? 'Oui ✓' : 'Non',
                entry.deadline || '-',
                entry.notes || '',
            ];
            XLSX.utils.sheet_add_aoa(ws, [row], { origin: -1 });
            this.updateIndexStats();
            this.saveWorkbook();
            this.logger.log(`Entrée ajoutée au suivi: ${entry.internalRfqNumber} (Client: ${entry.clientRfqNumber || 'N/A'})`);
            return true;
        }
        catch (error) {
            this.logger.error(`Erreur ajout entrée de suivi: ${error.message}`);
            return false;
        }
    }
    formatStatus(status) {
        const statusMap = {
            'traité': '✅ Traité',
            'en_attente': '⏳ En attente',
            'erreur': '❌ Erreur',
            'révision_manuelle': '👁️ Révision manuelle',
        };
        return statusMap[status] || status;
    }
    updateIndexStats() {
        if (!this.workbook || !this.workbook.SheetNames.includes('Index'))
            return;
        try {
            let totalEntries = 0;
            for (const sheetName of this.workbook.SheetNames) {
                if (sheetName !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
                    const ws = this.workbook.Sheets[sheetName];
                    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
                    totalEntries += Math.max(0, range.e.r);
                }
            }
            const indexWs = this.workbook.Sheets['Index'];
            indexWs['B11'] = { t: 'n', v: totalEntries };
            indexWs['B12'] = { t: 's', v: new Date().toLocaleString('fr-FR') };
        }
        catch (error) {
            this.logger.warn(`Erreur mise à jour stats Index: ${error.message}`);
        }
    }
    reloadWorkbook() {
        try {
            if (fs.existsSync(this.trackingFilePath)) {
                this.workbook = XLSX.readFile(this.trackingFilePath);
            }
        }
        catch (error) {
            this.logger.warn(`Erreur rechargement fichier: ${error.message}`);
        }
    }
    saveWorkbook() {
        if (!this.workbook)
            return;
        try {
            XLSX.writeFile(this.workbook, this.trackingFilePath);
            this.logger.debug(`Fichier de suivi sauvegardé: ${this.trackingFilePath}`);
        }
        catch (error) {
            this.logger.error(`Erreur sauvegarde fichier de suivi: ${error.message}`);
        }
    }
    getTrackingFilePath() {
        return this.trackingFilePath;
    }
    getStatistics() {
        this.reloadWorkbook();
        let totalEntries = 0;
        let todayEntries = 0;
        const todaySheet = this.getSheetName(new Date());
        if (this.workbook) {
            for (const sheetName of this.workbook.SheetNames) {
                if (sheetName !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
                    const ws = this.workbook.Sheets[sheetName];
                    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
                    const entries = Math.max(0, range.e.r);
                    totalEntries += entries;
                    if (sheetName === todaySheet) {
                        todayEntries = entries;
                    }
                }
            }
        }
        return {
            totalEntries,
            todayEntries,
            lastUpdate: new Date().toLocaleString('fr-FR'),
            sheetCount: this.workbook ?
                this.workbook.SheetNames.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).length : 0,
        };
    }
    isRfqAlreadyTracked(clientRfqNumber, clientEmail) {
        this.reloadWorkbook();
        if (!this.workbook || !clientRfqNumber)
            return false;
        const todaySheet = this.getSheetName(new Date());
        if (!this.workbook.SheetNames.includes(todaySheet)) {
            return false;
        }
        const ws = this.workbook.Sheets[todaySheet];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[1] === clientRfqNumber && row[4] === clientEmail) {
                return true;
            }
        }
        return false;
    }
};
exports.TrackingService = TrackingService;
exports.TrackingService = TrackingService = TrackingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TrackingService);
//# sourceMappingURL=tracking.service.js.map