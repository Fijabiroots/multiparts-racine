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
var ExcelService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExcelService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs/promises");
let ExcelService = ExcelService_1 = class ExcelService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(ExcelService_1.name);
    }
    async generatePriceRequestExcel(priceRequest) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Price Request Generator';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Demande de Prix', {
            pageSetup: {
                paperSize: 9,
                orientation: 'portrait',
                fitToPage: true,
            },
        });
        sheet.columns = [
            { header: 'N°', key: 'numero', width: 6 },
            { header: 'Code Fournisseur', key: 'supplierCode', width: 18 },
            { header: 'Marque', key: 'brand', width: 12 },
            { header: 'Désignation', key: 'description', width: 40 },
            { header: 'Qté', key: 'quantity', width: 8 },
            { header: 'Unité', key: 'unit', width: 8 },
            { header: 'Prix Unit. HT', key: 'prixUnitaire', width: 14 },
            { header: 'Prix Total HT', key: 'prixTotal', width: 14 },
            { header: 'Code Interne', key: 'internalCode', width: 12 },
        ];
        this.addHeader(sheet, priceRequest);
        const headerRow = sheet.getRow(8);
        headerRow.values = ['N°', 'Code Fournisseur', 'Marque', 'Désignation', 'Qté', 'Unité', 'Prix Unit. HT', 'Prix Total HT', 'Code Interne'];
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2F5496' },
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 25;
        headerRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'medium' },
                bottom: { style: 'medium' },
                left: { style: 'thin' },
                right: { style: 'thin' },
            };
        });
        let rowIndex = 9;
        priceRequest.items.forEach((item, index) => {
            const row = sheet.getRow(rowIndex);
            row.values = [
                index + 1,
                item.supplierCode || item.reference || '',
                item.brand || '',
                item.description,
                item.quantity,
                item.unit || 'pcs',
                '',
                { formula: `E${rowIndex}*G${rowIndex}` },
                item.internalCode || '',
            ];
            row.eachCell((cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' },
                };
                if (colNumber === 7) {
                    cell.font = { color: { argb: 'FF0000FF' } };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF2CC' },
                    };
                }
                if (colNumber === 5) {
                    cell.numFmt = '#,##0';
                }
                if (colNumber === 7 || colNumber === 8) {
                    cell.numFmt = '#,##0.00 €';
                }
            });
            row.alignment = { vertical: 'middle', wrapText: true };
            rowIndex++;
        });
        const totalRow = sheet.getRow(rowIndex + 1);
        totalRow.values = ['', '', '', '', '', '', 'TOTAL HT:', { formula: `SUM(H9:H${rowIndex - 1})` }, ''];
        totalRow.font = { bold: true };
        totalRow.getCell(8).numFmt = '#,##0.00 €';
        totalRow.getCell(8).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD9E2F3' },
        };
        const tvaRow = sheet.getRow(rowIndex + 2);
        tvaRow.values = ['', '', '', '', '', '', 'TVA (20%):', { formula: `H${rowIndex + 1}*0.2` }, ''];
        tvaRow.getCell(8).numFmt = '#,##0.00 €';
        const ttcRow = sheet.getRow(rowIndex + 3);
        ttcRow.values = ['', '', '', '', '', '', 'TOTAL TTC:', { formula: `H${rowIndex + 1}+H${rowIndex + 2}` }, ''];
        ttcRow.font = { bold: true, size: 12 };
        ttcRow.getCell(8).numFmt = '#,##0.00 €';
        ttcRow.getCell(8).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF92D050' },
        };
        this.addFooter(sheet, rowIndex + 5, priceRequest);
        sheet.protect('priceRequest2024', {
            selectLockedCells: true,
            selectUnlockedCells: true,
            formatCells: false,
        });
        for (let i = 9; i < rowIndex; i++) {
            sheet.getCell(`G${i}`).protection = { locked: false };
        }
        const buffer = await workbook.xlsx.writeBuffer();
        const outputDir = this.configService.get('app.outputDir') || './output';
        await fs.mkdir(outputDir, { recursive: true });
        const filename = `demande_prix_${priceRequest.requestNumber}_${Date.now()}.xlsx`;
        const filepath = path.join(outputDir, filename);
        await fs.writeFile(filepath, Buffer.from(buffer));
        this.logger.log(`Fichier Excel généré: ${filepath}`);
        return {
            priceRequest,
            excelPath: filepath,
            excelBuffer: Buffer.from(buffer),
        };
    }
    addHeader(sheet, priceRequest) {
        sheet.mergeCells('A1:I1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = 'DEMANDE DE PRIX';
        titleCell.font = { bold: true, size: 18, color: { argb: 'FF2F5496' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 35;
        sheet.getCell('A3').value = `N° Demande: ${priceRequest.requestNumber}`;
        sheet.getCell('A3').font = { bold: true };
        sheet.getCell('A4').value = `Date: ${priceRequest.date.toLocaleDateString('fr-FR')}`;
        const responseHours = priceRequest.responseDeadlineHours || 24;
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + responseHours);
        sheet.getCell('A5').value = `Réponse sous ${responseHours}h (avant le ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
        sheet.getCell('A5').font = { bold: true, color: { argb: 'FFFF0000' } };
        sheet.getRow(7).height = 10;
    }
    addFooter(sheet, startRow, priceRequest) {
        sheet.mergeCells(`A${startRow}:H${startRow}`);
        const instructionsCell = sheet.getCell(`A${startRow}`);
        instructionsCell.value = 'INSTRUCTIONS: Veuillez remplir les cellules jaunes (Prix Unitaire HT) et retourner ce document complété.';
        instructionsCell.font = { italic: true, color: { argb: 'FF666666' } };
        if (priceRequest.notes) {
            sheet.mergeCells(`A${startRow + 1}:H${startRow + 2}`);
            const notesCell = sheet.getCell(`A${startRow + 1}`);
            notesCell.value = `Notes: ${priceRequest.notes}`;
            notesCell.alignment = { wrapText: true };
        }
    }
    generateRequestNumber() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const random = Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, '0');
        return `DDP-${year}${month}${day}-${random}`;
    }
};
exports.ExcelService = ExcelService;
exports.ExcelService = ExcelService = ExcelService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ExcelService);
//# sourceMappingURL=excel.service.js.map