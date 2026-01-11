import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PriceRequest, GeneratedPriceRequest } from '../common/interfaces';

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  constructor(private configService: ConfigService) {}

  async generatePriceRequestExcel(priceRequest: PriceRequest): Promise<GeneratedPriceRequest> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Price Request Generator';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Demande de Prix', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'portrait',
        fitToPage: true,
      },
    });

    // Configuration des colonnes
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

    // En-tête du document
    this.addHeader(sheet, priceRequest);

    // Ligne de séparation
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

    // Bordures pour l'en-tête
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'medium' },
        bottom: { style: 'medium' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Données des articles
    let rowIndex = 9;
    priceRequest.items.forEach((item, index) => {
      const row = sheet.getRow(rowIndex);
      row.values = [
        index + 1,
        item.supplierCode || item.reference || '',  // Code fournisseur
        item.brand || '',                            // Marque
        item.description,                            // Désignation
        item.quantity,                               // Quantité
        item.unit || 'pcs',                          // Unité
        '',                                          // Prix unitaire (à remplir)
        { formula: `E${rowIndex}*G${rowIndex}` },   // Prix total = Qté * Prix Unit
        item.internalCode || '',                     // Code interne client
      ];

      // Style des cellules de données
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };

        // Colonne prix unitaire en bleu (à remplir) - colonne 7
        if (colNumber === 7) {
          cell.font = { color: { argb: 'FF0000FF' } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF2CC' },
          };
        }

        // Format nombre pour quantité (colonne 5) et prix (colonnes 7, 8)
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

    // Ligne de total
    const totalRow = sheet.getRow(rowIndex + 1);
    totalRow.values = ['', '', '', '', '', '', 'TOTAL HT:', { formula: `SUM(H9:H${rowIndex - 1})` }, ''];
    totalRow.font = { bold: true };
    totalRow.getCell(8).numFmt = '#,##0.00 €';
    totalRow.getCell(8).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E2F3' },
    };

    // TVA et TTC
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

    // Pied de page avec instructions
    this.addFooter(sheet, rowIndex + 5, priceRequest);

    // Protection des cellules (sauf prix unitaire)
    sheet.protect('priceRequest2024', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
    });

    // Déprotéger les cellules de prix unitaire (colonne G)
    for (let i = 9; i < rowIndex; i++) {
      sheet.getCell(`G${i}`).protection = { locked: false };
    }

    // Générer le buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const outputDir = this.configService.get<string>('app.outputDir') || './output';
    await fs.mkdir(outputDir, { recursive: true });

    const filename = `demande_prix_${priceRequest.requestNumber}_${Date.now()}.xlsx`;
    const filepath = path.join(outputDir, filename);
    await fs.writeFile(filepath, Buffer.from(buffer as ArrayBuffer));

    this.logger.log(`Fichier Excel généré: ${filepath}`);

    return {
      priceRequest,
      excelPath: filepath,
      excelBuffer: Buffer.from(buffer as ArrayBuffer),
    };
  }

  private addHeader(sheet: ExcelJS.Worksheet, priceRequest: PriceRequest): void {
    // Titre
    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'DEMANDE DE PRIX';
    titleCell.font = { bold: true, size: 18, color: { argb: 'FF2F5496' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 35;

    // Informations - Colonne gauche (Demande interne)
    sheet.getCell('A3').value = `N° Demande: ${priceRequest.requestNumber}`;
    sheet.getCell('A3').font = { bold: true };

    sheet.getCell('A4').value = `Date: ${priceRequest.date.toLocaleDateString('fr-FR')}`;

    // Délai de réponse
    const responseHours = priceRequest.responseDeadlineHours || 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);
    sheet.getCell('A5').value = `Réponse sous ${responseHours}h (avant le ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
    sheet.getCell('A5').font = { bold: true, color: { argb: 'FFFF0000' } };

    // Informations - Colonne droite (Client)
    //if (priceRequest.clientRfqNumber) {
    //  sheet.getCell('F3').value = `Réf. Client: ${priceRequest.clientRfqNumber}`;
    //  sheet.getCell('F3').font = { bold: true, color: { argb: 'FF0066CC' } };
    //}

    //if (priceRequest.clientName) {
      //sheet.getCell('F4').value = `Client: ${priceRequest.clientName}`;
    //}

    //if (priceRequest.clientEmail) {
    //  sheet.getCell('F5').value = `Contact: ${priceRequest.clientEmail}`;
    //}

    // Ligne vide
    sheet.getRow(7).height = 10;
  }

  private addFooter(sheet: ExcelJS.Worksheet, startRow: number, priceRequest: PriceRequest): void {
    sheet.mergeCells(`A${startRow}:H${startRow}`);
    const instructionsCell = sheet.getCell(`A${startRow}`);
    instructionsCell.value = 'INSTRUCTIONS: Veuillez remplir les cellules jaunes (Prix Unitaire HT) et retourner ce document complété.';
    instructionsCell.font = { italic: true, color: { argb: 'FF666666' } };

    // Notes désactivées - contenaient des infos du demandeur non pertinentes
    // if (priceRequest.notes) {
    //   sheet.mergeCells(`A${startRow + 1}:H${startRow + 2}`);
    //   const notesCell = sheet.getCell(`A${startRow + 1}`);
    //   notesCell.value = `Notes: ${priceRequest.notes}`;
    //   notesCell.alignment = { wrapText: true };
    // }

    // Conditions
    //sheet.mergeCells(`A${startRow + 4}:H${startRow + 6}`);
    //const conditionsCell = sheet.getCell(`A${startRow + 4}`);
    //conditionsCell.value = `Conditions générales:
//- Les prix doivent être exprimés en Euros HT
//- Délai de validité de l'offre: 30 jours
//- Merci d'indiquer les délais de livraison`;
    //conditionsCell.alignment = { wrapText: true, vertical: 'top' };
    //conditionsCell.font = { size: 9 };
  }

  generateRequestNumber(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `DDP-${year}${month}${day}-${random}`;
  }
}
