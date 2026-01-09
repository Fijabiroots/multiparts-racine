import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as XLSX from 'xlsx';
import * as pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { WebhookService } from '../webhook/webhook.service';
import { SupplierQuote, QuoteItem } from './rfq-lifecycle.service';
import { LogisticsInfo, LogisticsSummary, extractLogisticsFromText, ShippingRecommendation } from './logistics.interface';
import { COMPANY_INFO, ShippingMode, recommendShippingMode } from '../common/company-info';

export interface ComparisonTable {
  rfqNumber: string;
  clientRfqNumber?: string;
  rfqSubject?: string;
  generatedAt: Date;
  lastUpdatedAt: Date;
  items: ComparisonItem[];
  suppliers: SupplierSummary[];
  recommendation?: string;
  shippingRecommendation?: string;
  filePath: string;
  version: number;
}

export interface ComparisonItem {
  lineNumber: number;
  description: string;
  partNumber?: string;
  requestedQty: number;
  unit?: string;
  supplierPrices: SupplierPrice[];
  lowestPrice?: number;
  lowestPriceSupplier?: string;
}

export interface SupplierPrice {
  supplierEmail: string;
  supplierName?: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  deliveryTime?: string;
  availability?: string;
  notes?: string;
}

export interface SupplierSummary {
  email: string;
  name?: string;
  totalAmount?: number;
  currency?: string;
  deliveryTime?: string;
  paymentTerms?: string;
  validity?: string;
  itemsQuoted: number;
  responseDate: Date;
  
  // Logistique
  totalWeightKg?: number;
  incoterm?: string;
  shippingMode?: string;
  hsCode?: string;
  countryOfOrigin?: string;
  shippingRecommendation?: ShippingRecommendation;
}

@Injectable()
export class QuoteComparisonService {
  private readonly logger = new Logger(QuoteComparisonService.name);
  private readonly outputDir: string;
  private readonly comparisonsDir: string;
  private comparisonCache: Map<string, ComparisonTable> = new Map();

  constructor(
    private configService: ConfigService,
    private webhookService: WebhookService,
  ) {
    this.outputDir = this.configService.get<string>('app.outputDir', './output');
    this.comparisonsDir = path.join(this.outputDir, 'comparatifs');
    
    if (!fs.existsSync(this.comparisonsDir)) {
      fs.mkdirSync(this.comparisonsDir, { recursive: true });
    }
    
    this.loadExistingComparisons();
  }

  private loadExistingComparisons(): void {
    try {
      const files = fs.readdirSync(this.comparisonsDir).filter(f => f.endsWith('.xlsx'));
      
      for (const file of files) {
        const match = file.match(/^comparatif-(.+)\.xlsx$/);
        if (match) {
          const rfqNumber = match[1].split('-').slice(0, 4).join('-');
          const filePath = path.join(this.comparisonsDir, file);
          
          const workbook = XLSX.readFile(filePath);
          const metaSheet = workbook.Sheets['Métadonnées'];
          
          if (metaSheet) {
            const data = XLSX.utils.sheet_to_json<any>(metaSheet);
            if (data.length > 0) {
              this.comparisonCache.set(rfqNumber, {
                rfqNumber,
                clientRfqNumber: data[0].clientRfqNumber,
                rfqSubject: data[0].rfqSubject,
                generatedAt: new Date(data[0].generatedAt),
                lastUpdatedAt: new Date(data[0].lastUpdatedAt),
                items: [],
                suppliers: [],
                filePath,
                version: data[0].version || 1,
              });
            }
          }
        }
      }
      
      this.logger.log(`${this.comparisonCache.size} comparatif(s) existant(s) chargé(s)`);
    } catch (error) {
      this.logger.warn(`Erreur chargement comparaisons: ${error.message}`);
    }
  }

  private generateFileName(rfqNumber: string, rfqSubject?: string): string {
    let baseName = rfqNumber;
    
    if (rfqSubject) {
      const cleanSubject = rfqSubject
        .replace(/^(Re:\s*)+/i, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[<>:"\/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 50)
        .replace(/_+$/, '');
      
      baseName = `${rfqNumber}-${cleanSubject}`;
    }
    
    return `comparatif-${baseName}.xlsx`;
  }

  private getComparisonFilePath(rfqNumber: string, rfqSubject?: string): string {
    const cached = this.comparisonCache.get(rfqNumber);
    if (cached && fs.existsSync(cached.filePath)) {
      return cached.filePath;
    }
    
    const fileName = this.generateFileName(rfqNumber, rfqSubject);
    return path.join(this.comparisonsDir, fileName);
  }

  hasComparison(rfqNumber: string): boolean {
    const cached = this.comparisonCache.get(rfqNumber);
    return cached !== undefined && fs.existsSync(cached.filePath);
  }

  getExistingComparison(rfqNumber: string): ComparisonTable | undefined {
    return this.comparisonCache.get(rfqNumber);
  }

  /**
   * Extraire les informations logistiques d'une offre
   */
  private extractLogistics(quote: SupplierQuote): LogisticsInfo {
    const text = [
      quote.rawText || '',
      quote.subject || '',
      quote.items.map(i => `${i.description} ${i.notes || ''}`).join(' '),
    ].join('\n');
    
    return extractLogisticsFromText(text);
  }

  /**
   * Parser une offre Excel avec extraction logistique
   */
  async parseExcelQuote(buffer: Buffer, supplierEmail: string, rfqNumber: string): Promise<SupplierQuote> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const items: QuoteItem[] = [];
    let totalAmount: number | undefined;
    let currency: string | undefined;
    let deliveryTime: string | undefined;
    let paymentTerms: string | undefined;
    let fullText = '';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });
      fullText += data.map(r => (r || []).join(' ')).join('\n');

      let headerRow = -1;
      let priceCol = -1;
      let qtyCol = -1;
      let descCol = -1;
      let unitPriceCol = -1;
      let weightCol = -1;
      let hsCodeCol = -1;
      let originCol = -1;

      for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row) continue;

        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j] || '').toLowerCase();
          
          if (cell.includes('description') || cell.includes('désignation') || cell.includes('article')) {
            descCol = j; headerRow = i;
          }
          if (cell.includes('qty') || cell.includes('qté') || cell.includes('quantit')) qtyCol = j;
          if (cell.includes('unit price') || cell.includes('prix unit') || cell.includes('p.u')) unitPriceCol = j;
          if (cell.includes('total') || cell.includes('amount') || cell.includes('montant')) priceCol = j;
          if (cell.includes('weight') || cell.includes('poids') || cell.includes('kg')) weightCol = j;
          if (cell.includes('hs') || cell.includes('tariff') || cell.includes('code')) hsCodeCol = j;
          if (cell.includes('origin') || cell.includes('origine') || cell.includes('country')) originCol = j;
        }
        
        if (headerRow >= 0) break;
      }

      if (headerRow >= 0 && descCol >= 0) {
        for (let i = headerRow + 1; i < data.length; i++) {
          const row = data[i];
          if (!row || !row[descCol]) continue;

          const desc = String(row[descCol] || '').trim();
          if (desc.length < 3) continue;
          if (/total|sous-total|sub-total/i.test(desc)) {
            if (priceCol >= 0 && row[priceCol]) totalAmount = this.parseNumber(row[priceCol]);
            continue;
          }

          const item: QuoteItem = {
            description: desc,
            quantity: qtyCol >= 0 ? this.parseNumber(row[qtyCol]) || 1 : 1,
            unitPrice: unitPriceCol >= 0 ? this.parseNumber(row[unitPriceCol]) : undefined,
            totalPrice: priceCol >= 0 ? this.parseNumber(row[priceCol]) : undefined,
            weightKg: weightCol >= 0 ? this.parseNumber(row[weightCol]) : undefined,
            hsCode: hsCodeCol >= 0 ? String(row[hsCodeCol] || '') : undefined,
            countryOfOrigin: originCol >= 0 ? String(row[originCol] || '') : undefined,
          };

          if (item.unitPrice || item.totalPrice) items.push(item);
        }
      }

      currency = this.extractCurrency(fullText);
      deliveryTime = this.extractDeliveryTime(fullText);
      paymentTerms = this.extractPaymentTerms(fullText);
    }

    // Extraire les infos logistiques
    const logistics = extractLogisticsFromText(fullText);
    
    // Calculer le poids total si non spécifié
    if (!logistics.totalWeightKg) {
      const itemsWeight = items.reduce((sum, i) => sum + (i.weightKg || 0), 0);
      if (itemsWeight > 0) logistics.totalWeightKg = itemsWeight;
    }

    return {
      supplierEmail,
      rfqNumber,
      receivedAt: new Date(),
      subject: '',
      currency,
      totalAmount,
      deliveryTime,
      paymentTerms,
      items,
      attachments: [],
      needsManualReview: items.length === 0,
      logistics,
    };
  }

  /**
   * Parser une offre PDF avec extraction logistique
   */
  async parsePdfQuote(buffer: Buffer, supplierEmail: string, rfqNumber: string): Promise<SupplierQuote> {
    let text = '';
    const items: QuoteItem[] = [];

    try {
      const tmpPath = `/tmp/quote_${Date.now()}.pdf`;
      fs.writeFileSync(tmpPath, buffer);
      try {
        text = execSync(`pdftotext -layout "${tmpPath}" -`, { timeout: 30000 }).toString();
      } catch {
        const parsed = await (pdfParse as any).default(buffer);
        text = parsed.text;
      }
      fs.unlinkSync(tmpPath);
    } catch (error) {
      this.logger.warn(`Erreur parsing PDF: ${error.message}`);
    }

    const currency = this.extractCurrency(text);
    const deliveryTime = this.extractDeliveryTime(text);
    const paymentTerms = this.extractPaymentTerms(text);
    const totalAmount = this.extractTotalAmount(text);
    const logistics = extractLogisticsFromText(text);

    const lines = text.split('\n');
    for (const line of lines) {
      const priceMatch = line.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|\$|EUR|USD|XOF|FCFA)/i);
      if (priceMatch) {
        const desc = line.substring(0, line.indexOf(priceMatch[0])).trim();
        if (desc.length > 5) {
          items.push({
            description: desc.substring(0, 100),
            quantity: 1,
            totalPrice: this.parseNumber(priceMatch[1]),
            currency,
          });
        }
      }
    }

    return {
      supplierEmail,
      rfqNumber,
      receivedAt: new Date(),
      subject: '',
      currency,
      totalAmount,
      deliveryTime,
      paymentTerms,
      items,
      attachments: [],
      rawText: text.substring(0, 5000),
      needsManualReview: items.length === 0,
      logistics,
    };
  }

  /**
   * Parser le corps d'email avec extraction logistique
   */
  parseEmailBodyQuote(body: string, supplierEmail: string, rfqNumber: string): SupplierQuote {
    const items: QuoteItem[] = [];
    const currency = this.extractCurrency(body);
    const deliveryTime = this.extractDeliveryTime(body);
    const paymentTerms = this.extractPaymentTerms(body);
    const totalAmount = this.extractTotalAmount(body);
    const logistics = extractLogisticsFromText(body);

    const pricePatterns = [
      /(.+?)[\s:]+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:€|\$|EUR|USD|XOF|FCFA)/gi,
    ];

    for (const pattern of pricePatterns) {
      let match;
      while ((match = pattern.exec(body)) !== null) {
        const desc = match[1].trim();
        if (desc.length > 3 && desc.length < 100 && !/total|sous-total/i.test(desc)) {
          items.push({
            description: desc,
            quantity: 1,
            totalPrice: this.parseNumber(match[2]),
            currency,
          });
        }
      }
    }

    return {
      supplierEmail,
      rfqNumber,
      receivedAt: new Date(),
      subject: '',
      currency,
      totalAmount,
      deliveryTime,
      paymentTerms,
      items,
      attachments: [],
      rawText: body.substring(0, 2000),
      needsManualReview: items.length === 0,
      logistics,
    };
  }

  /**
   * Ajouter ou mettre à jour une offre dans le tableau comparatif
   */
  async addOrUpdateQuote(
    rfqNumber: string,
    quote: SupplierQuote,
    rfqSubject?: string,
    clientRfqNumber?: string,
    originalItems?: { description: string; quantity: number; unit?: string }[]
  ): Promise<ComparisonTable> {
    
    const isNewComparison = !this.hasComparison(rfqNumber);
    const filePath = this.getComparisonFilePath(rfqNumber, rfqSubject);
    
    let comparison: ComparisonTable;
    
    if (isNewComparison) {
      comparison = {
        rfqNumber,
        clientRfqNumber,
        rfqSubject,
        generatedAt: new Date(),
        lastUpdatedAt: new Date(),
        items: [],
        suppliers: [],
        filePath,
        version: 1,
      };
      
      this.logger.log(`📊 Nouveau tableau comparatif créé: ${rfqNumber}`);
    } else {
      comparison = await this.loadComparisonFromFile(rfqNumber, filePath);
      comparison.lastUpdatedAt = new Date();
      comparison.version++;
      
      this.logger.log(`📊 Mise à jour tableau comparatif: ${rfqNumber} (v${comparison.version})`);
    }

    // Extraire/compléter les infos logistiques
    if (!quote.logistics) {
      quote.logistics = this.extractLogistics(quote);
    }

    // Calculer la recommandation d'expédition
    const shippingRec = quote.logistics?.totalWeightKg 
      ? recommendShippingMode(quote.logistics.totalWeightKg, quote.logistics.volumetricWeightKg)
      : undefined;

    // Ajouter/mettre à jour le fournisseur
    const existingSupplier = comparison.suppliers.find(s => s.email === quote.supplierEmail);
    const supplierData: SupplierSummary = {
      email: quote.supplierEmail,
      name: quote.supplierName,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      deliveryTime: quote.deliveryTime,
      paymentTerms: quote.paymentTerms,
      validity: quote.validity,
      itemsQuoted: quote.items.length,
      responseDate: quote.receivedAt,
      totalWeightKg: quote.logistics?.totalWeightKg,
      incoterm: quote.logistics?.incoterm,
      shippingMode: quote.logistics?.proposedShippingMode,
      hsCode: quote.logistics?.hsCode,
      countryOfOrigin: quote.logistics?.countryOfOrigin,
      shippingRecommendation: shippingRec ? { mode: shippingRec.recommended, ...shippingRec } : undefined,
    };

    if (!existingSupplier) {
      comparison.suppliers.push(supplierData);
    } else {
      Object.assign(existingSupplier, supplierData);
    }

    // Reconstruire les items de comparaison
    comparison.items = this.buildComparisonItems(comparison.suppliers, [quote], originalItems);

    // Calculer les recommandations
    comparison.recommendation = this.calculateRecommendation(comparison);
    comparison.shippingRecommendation = this.calculateShippingRecommendation(comparison);

    // Sauvegarder
    await this.saveComparisonToFile(comparison);
    this.comparisonCache.set(rfqNumber, comparison);

    // Webhooks
    if (isNewComparison) {
      await this.webhookService.emitComparisonCreated(rfqNumber, filePath, comparison.suppliers.length);
    } else {
      await this.webhookService.emitComparisonUpdated(rfqNumber, filePath, comparison.suppliers.length, quote.supplierEmail);
    }

    return comparison;
  }

  private async loadComparisonFromFile(rfqNumber: string, filePath: string): Promise<ComparisonTable> {
    const cached = this.comparisonCache.get(rfqNumber);
    
    if (!fs.existsSync(filePath)) {
      return {
        rfqNumber,
        generatedAt: new Date(),
        lastUpdatedAt: new Date(),
        items: [],
        suppliers: [],
        filePath,
        version: 1,
      };
    }

    const workbook = XLSX.readFile(filePath);
    const metaSheet = workbook.Sheets['Métadonnées'];
    let meta: any = {};
    if (metaSheet) {
      const metaData = XLSX.utils.sheet_to_json<any>(metaSheet);
      if (metaData.length > 0) meta = metaData[0];
    }

    const suppliersSheet = workbook.Sheets['Résumé Fournisseurs'];
    const suppliers: SupplierSummary[] = [];
    if (suppliersSheet) {
      const suppData = XLSX.utils.sheet_to_json<any>(suppliersSheet, { range: 2 });
      for (const row of suppData) {
        if (row.Email) {
          suppliers.push({
            email: row.Email,
            name: row.Fournisseur || undefined,
            totalAmount: row['Total'],
            currency: row['Devise'],
            deliveryTime: row['Délai'],
            paymentTerms: row['Conditions'],
            itemsQuoted: row['Nb Items'] || 0,
            responseDate: row['Date Réponse'] ? new Date(row['Date Réponse']) : new Date(),
            totalWeightKg: row['Poids (kg)'],
            incoterm: row['Incoterm'],
            shippingMode: row['Mode Expédition'],
            hsCode: row['Code HS'],
            countryOfOrigin: row['Pays Origine'],
          });
        }
      }
    }

    return {
      rfqNumber,
      clientRfqNumber: meta.clientRfqNumber,
      rfqSubject: meta.rfqSubject,
      generatedAt: meta.generatedAt ? new Date(meta.generatedAt) : new Date(),
      lastUpdatedAt: new Date(),
      items: [],
      suppliers,
      filePath,
      version: (meta.version || 0) + 1,
    };
  }

  private buildComparisonItems(
    suppliers: SupplierSummary[],
    quotes: SupplierQuote[],
    originalItems?: { description: string; quantity: number; unit?: string }[]
  ): ComparisonItem[] {
    const itemDescriptions = new Set<string>();
    
    if (originalItems) {
      for (const item of originalItems) {
        itemDescriptions.add(item.description.toLowerCase().substring(0, 50));
      }
    }
    
    for (const quote of quotes) {
      for (const item of quote.items) {
        itemDescriptions.add(item.description.toLowerCase().substring(0, 50));
      }
    }

    const comparisonItems: ComparisonItem[] = [];
    let lineNumber = 1;

    for (const desc of itemDescriptions) {
      const compItem: ComparisonItem = {
        lineNumber: lineNumber++,
        description: desc,
        requestedQty: originalItems?.find(i => i.description.toLowerCase().startsWith(desc))?.quantity || 1,
        supplierPrices: [],
      };

      for (const quote of quotes) {
        const matchingItem = quote.items.find(i => 
          i.description.toLowerCase().includes(desc) || 
          desc.includes(i.description.toLowerCase().substring(0, 20))
        );

        compItem.supplierPrices.push({
          supplierEmail: quote.supplierEmail,
          supplierName: quote.supplierName,
          unitPrice: matchingItem?.unitPrice,
          totalPrice: matchingItem?.totalPrice,
          currency: matchingItem?.currency || quote.currency,
          deliveryTime: matchingItem?.deliveryTime || quote.deliveryTime,
        });
      }

      const prices = compItem.supplierPrices
        .filter(p => p.totalPrice || p.unitPrice)
        .map(p => ({ 
          price: p.totalPrice || (p.unitPrice! * compItem.requestedQty), 
          supplier: p.supplierEmail 
        }));
      
      if (prices.length > 0) {
        const lowest = prices.reduce((min, p) => p.price < min.price ? p : min);
        compItem.lowestPrice = lowest.price;
        compItem.lowestPriceSupplier = lowest.supplier;
      }

      comparisonItems.push(compItem);
    }

    return comparisonItems;
  }

  private calculateRecommendation(comparison: ComparisonTable): string | undefined {
    if (comparison.suppliers.length === 0) return undefined;

    const suppliersWithTotal = comparison.suppliers.filter(s => s.totalAmount);
    
    if (suppliersWithTotal.length > 0) {
      const best = suppliersWithTotal.sort((a, b) => (a.totalAmount || Infinity) - (b.totalAmount || Infinity))[0];
      return `Meilleure offre globale: ${best.name || best.email} - ${best.totalAmount?.toLocaleString('fr-FR')} ${best.currency || ''}`;
    }

    return undefined;
  }

  private calculateShippingRecommendation(comparison: ComparisonTable): string | undefined {
    // Trouver le poids total maximum parmi les fournisseurs
    const weights = comparison.suppliers
      .filter(s => s.totalWeightKg)
      .map(s => s.totalWeightKg!);
    
    if (weights.length === 0) return undefined;

    const maxWeight = Math.max(...weights);
    const rec = recommendShippingMode(maxWeight);

    return `${rec.recommended} recommandé - ${rec.reason}`;
  }

  /**
   * Sauvegarder le comparatif avec les infos logistiques
   */
  private async saveComparisonToFile(comparison: ComparisonTable): Promise<void> {
    const workbook = XLSX.utils.book_new();

    // ========================================
    // Feuille 0: En-tête avec infos société
    // ========================================
    const headerData: any[][] = [
      ['TABLEAU COMPARATIF DES OFFRES'],
      [''],
      [`Référence: ${comparison.rfqNumber}${comparison.clientRfqNumber ? ` (Client: ${comparison.clientRfqNumber})` : ''}`],
      [`Objet: ${comparison.rfqSubject || '-'}`],
      [''],
      ['DEMANDEUR:'],
      [COMPANY_INFO.name],
      [COMPANY_INFO.address.line1],
      [COMPANY_INFO.address.line2],
      [`${COMPANY_INFO.address.city}, ${COMPANY_INFO.address.country}`],
      [''],
      [`Contact: ${COMPANY_INFO.contact.name} - ${COMPANY_INFO.contact.title}`],
      [`Tél: ${COMPANY_INFO.contact.phone} | Mobile: ${COMPANY_INFO.contact.mobile}`],
      [`Email: ${COMPANY_INFO.contact.primaryEmail}`],
      [''],
      [`Généré le: ${comparison.generatedAt.toLocaleString('fr-FR')}`],
      [`Dernière MAJ: ${comparison.lastUpdatedAt.toLocaleString('fr-FR')} | Version: ${comparison.version}`],
    ];

    const headerSheet = XLSX.utils.aoa_to_sheet(headerData);
    headerSheet['!cols'] = [{ wch: 70 }];
    XLSX.utils.book_append_sheet(workbook, headerSheet, 'En-tête');

    // ========================================
    // Feuille 1: Comparaison des prix
    // ========================================
    const compData: any[][] = [
      [`COMPARAISON DES PRIX - ${comparison.rfqNumber}`],
      [''],
    ];

    // En-têtes dynamiques
    const headers = ['N°', 'Description', 'Qté'];
    for (const supplier of comparison.suppliers) {
      const name = supplier.name || supplier.email.split('@')[0];
      headers.push(`${name} (Prix)`);
      headers.push('Délai');
    }
    headers.push('✓ Meilleur Prix', '✓ Meilleur Fournisseur');
    compData.push(headers);

    // Données des items
    for (const item of comparison.items) {
      const row: any[] = [item.lineNumber, item.description, item.requestedQty];

      for (const supplier of comparison.suppliers) {
        const sp = item.supplierPrices.find(p => p.supplierEmail === supplier.email);
        row.push(sp?.totalPrice || sp?.unitPrice || '-');
        row.push(sp?.deliveryTime || '-');
      }

      row.push(item.lowestPrice?.toLocaleString('fr-FR') || '-');
      row.push(item.lowestPriceSupplier ? item.lowestPriceSupplier.split('@')[0] : '-');
      
      compData.push(row);
    }

    // Ligne de total
    compData.push([]);
    const totalRow: any[] = ['', 'TOTAL', ''];
    for (const supplier of comparison.suppliers) {
      totalRow.push(supplier.totalAmount?.toLocaleString('fr-FR') || '-');
      totalRow.push(supplier.currency || '');
    }
    compData.push(totalRow);

    const compSheet = XLSX.utils.aoa_to_sheet(compData);
    compSheet['!cols'] = [
      { wch: 5 }, { wch: 45 }, { wch: 6 },
      ...comparison.suppliers.flatMap(() => [{ wch: 14 }, { wch: 12 }]),
      { wch: 14 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, compSheet, 'Comparaison Prix');

    // ========================================
    // Feuille 2: Résumé Fournisseurs avec Logistique
    // ========================================
    const summaryData: any[][] = [
      ['RÉSUMÉ DES OFFRES FOURNISSEURS'],
      [''],
      ['Fournisseur', 'Email', 'Total', 'Devise', 'Délai Livraison', 'Conditions Paiement', 'Nb Items', 'Date Réponse'],
    ];

    for (const s of comparison.suppliers) {
      summaryData.push([
        s.name || '-',
        s.email,
        s.totalAmount?.toLocaleString('fr-FR') || '-',
        s.currency || '-',
        s.deliveryTime || '-',
        s.paymentTerms || '-',
        s.itemsQuoted,
        s.responseDate.toLocaleDateString('fr-FR'),
      ]);
    }

    if (comparison.recommendation) {
      summaryData.push([]);
      summaryData.push([`💡 RECOMMANDATION PRIX: ${comparison.recommendation}`]);
    }

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [
      { wch: 25 }, { wch: 35 }, { wch: 15 }, { wch: 8 },
      { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Résumé Fournisseurs');

    // ========================================
    // Feuille 3: Informations Logistiques
    // ========================================
    const logisticsData: any[][] = [
      ['INFORMATIONS LOGISTIQUES'],
      [''],
      ['Fournisseur', 'Poids Total (kg)', 'Incoterm', 'Mode Expédition', 'Code HS/SH', 'Pays Origine', 'Recommandation Expédition'],
    ];

    for (const s of comparison.suppliers) {
      const rec = s.shippingRecommendation;
      logisticsData.push([
        s.name || s.email.split('@')[0],
        s.totalWeightKg?.toFixed(2) || '-',
        s.incoterm || '-',
        s.shippingMode || '-',
        s.hsCode || '-',
        s.countryOfOrigin || '-',
        rec ? `${rec.mode} - ${rec.reason}` : '-',
      ]);
    }

    logisticsData.push([]);
    logisticsData.push(['RÈGLES DE RECOMMANDATION D\'EXPÉDITION:']);
    logisticsData.push(['• Poids > 100 kg → Transport MARITIME (Bateau) recommandé']);
    logisticsData.push(['• Poids 30-100 kg → Transport AÉRIEN (Avion) recommandé']);
    logisticsData.push(['• Poids < 30 kg → EXPRESS possible (vérifier poids volumétrique)']);
    logisticsData.push(['• Calcul poids volumétrique: (L × l × H en cm) / 5000']);
    logisticsData.push([]);
    logisticsData.push([`📍 Destination: ${COMPANY_INFO.defaultPort}`]);
    logisticsData.push([`📦 Incoterm préféré: ${COMPANY_INFO.defaultIncoterm}`]);

    if (comparison.shippingRecommendation) {
      logisticsData.push([]);
      logisticsData.push([`🚚 RECOMMANDATION GLOBALE: ${comparison.shippingRecommendation}`]);
    }

    const logisticsSheet = XLSX.utils.aoa_to_sheet(logisticsData);
    logisticsSheet['!cols'] = [
      { wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 18 },
      { wch: 15 }, { wch: 18 }, { wch: 45 },
    ];
    XLSX.utils.book_append_sheet(workbook, logisticsSheet, 'Logistique');

    // ========================================
    // Feuille 4: Métadonnées
    // ========================================
    const metaData = [
      ['rfqNumber', 'clientRfqNumber', 'rfqSubject', 'generatedAt', 'lastUpdatedAt', 'version', 'supplierCount'],
      [
        comparison.rfqNumber,
        comparison.clientRfqNumber || '',
        comparison.rfqSubject || '',
        comparison.generatedAt.toISOString(),
        comparison.lastUpdatedAt.toISOString(),
        comparison.version,
        comparison.suppliers.length,
      ],
    ];
    const metaSheet = XLSX.utils.aoa_to_sheet(metaData);
    XLSX.utils.book_append_sheet(workbook, metaSheet, 'Métadonnées');

    // Sauvegarder
    XLSX.writeFile(workbook, comparison.filePath);
    this.logger.log(`💾 Comparatif sauvegardé: ${comparison.filePath}`);
  }

  async generateComparisonTable(
    rfqNumber: string,
    quotes: SupplierQuote[],
    originalItems?: { description: string; quantity: number; unit?: string }[],
    rfqSubject?: string,
    clientRfqNumber?: string,
  ): Promise<ComparisonTable> {
    if (quotes.length === 1) {
      return this.addOrUpdateQuote(rfqNumber, quotes[0], rfqSubject, clientRfqNumber, originalItems);
    }

    let comparison: ComparisonTable | undefined;
    for (const quote of quotes) {
      comparison = await this.addOrUpdateQuote(rfqNumber, quote, rfqSubject, clientRfqNumber, originalItems);
    }

    return comparison!;
  }

  // Utilitaires
  private parseNumber(value: any): number | undefined {
    if (typeof value === 'number') return value;
    if (!value) return undefined;
    const cleaned = String(value).replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  private extractCurrency(text: string): string | undefined {
    if (/EUR|€/i.test(text)) return 'EUR';
    if (/USD|\$/i.test(text)) return 'USD';
    if (/XOF|FCFA|CFA/i.test(text)) return 'XOF';
    if (/GBP|£/i.test(text)) return 'GBP';
    return undefined;
  }

  private extractDeliveryTime(text: string): string | undefined {
    const patterns = [
      /d[ée]lai[:\s]+([^.\n]+)/i,
      /delivery[:\s]+([^.\n]+)/i,
      /(\d+)\s*(?:semaines?|weeks?|jours?|days?)/i,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1].trim().substring(0, 50);
    }
    return undefined;
  }

  private extractPaymentTerms(text: string): string | undefined {
    const patterns = [
      /payment[:\s]+([^.\n]+)/i,
      /paiement[:\s]+([^.\n]+)/i,
      /(\d+)\s*(?:jours?|days?)\s*(?:net|fin de mois)/i,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return match[1].trim().substring(0, 50);
    }
    return undefined;
  }

  private extractTotalAmount(text: string): number | undefined {
    const patterns = [
      /total[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
      /montant[:\s]*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match) return this.parseNumber(match[1]);
    }
    return undefined;
  }
}
