import { Controller, Get, Post, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { RfqLifecycleService } from './rfq-lifecycle.service';
import { QuoteComparisonService } from './quote-comparison.service';
import { ReminderService } from './reminder.service';
import { InboundScannerService } from './inbound-scanner.service';

@Controller('rfq-lifecycle')
export class RfqLifecycleController {
  constructor(
    private readonly lifecycleService: RfqLifecycleService,
    private readonly comparisonService: QuoteComparisonService,
    private readonly reminderService: ReminderService,
    private readonly inboundService: InboundScannerService,
  ) {}

  /**
   * GET /rfq-lifecycle/sent
   * Liste toutes les demandes envoyées aux fournisseurs
   */
  @Get('sent')
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

  /**
   * GET /rfq-lifecycle/sent/:rfqNumber
   * Détail d'une demande spécifique
   */
  @Get('sent/:rfqNumber')
  getRfqDetail(@Param('rfqNumber') rfqNumber: string) {
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

  /**
   * POST /rfq-lifecycle/scan-sent
   * Scanner manuellement les emails envoyés
   */
  @Post('scan-sent')
  async scanSentEmails() {
    const newRfqs = await this.lifecycleService.scanSentEmails();
    return {
      success: true,
      message: `${newRfqs.length} nouvelle(s) demande(s) détectée(s)`,
      data: newRfqs,
    };
  }

  /**
   * POST /rfq-lifecycle/scan-inbox
   * Scanner manuellement les emails entrants
   */
  @Post('scan-inbox')
  async scanInbox() {
    const result = await this.inboundService.scanInboundEmails();
    return {
      success: true,
      message: `Scan terminé: ${result.quotes} offre(s), ${result.declines} refus`,
      data: result,
    };
  }

  /**
   * GET /rfq-lifecycle/quotes/:rfqNumber
   * Obtenir les offres pour un RFQ
   */
  @Get('quotes/:rfqNumber')
  getQuotes(@Param('rfqNumber') rfqNumber: string) {
    const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
    return {
      success: true,
      count: quotes.length,
      data: quotes,
    };
  }

  /**
   * POST /rfq-lifecycle/comparison/:rfqNumber
   * Générer le tableau comparatif
   */
  @Post('comparison/:rfqNumber')
  async generateComparison(@Param('rfqNumber') rfqNumber: string) {
    const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
    
    if (quotes.length === 0) {
      return { success: false, error: 'Aucune offre reçue pour ce RFQ' };
    }

    const comparison = await this.comparisonService.generateComparisonTable(
      rfqNumber,
      quotes
    );

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

  /**
   * GET /rfq-lifecycle/comparison/:rfqNumber/download
   * Télécharger le tableau comparatif
   */
  @Get('comparison/:rfqNumber/download')
  async downloadComparison(
    @Param('rfqNumber') rfqNumber: string,
    @Res() res: Response
  ) {
    const quotes = this.lifecycleService.getQuotesForRfq(rfqNumber);
    
    if (quotes.length === 0) {
      return res.status(404).json({ success: false, error: 'Aucune offre' });
    }

    const comparison = await this.comparisonService.generateComparisonTable(
      rfqNumber,
      quotes
    );

    if (!comparison.filePath || !fs.existsSync(comparison.filePath)) {
      return res.status(404).json({ success: false, error: 'Fichier non trouvé' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="comparatif-${rfqNumber}.xlsx"`);
    
    fs.createReadStream(comparison.filePath).pipe(res);
  }

  /**
   * GET /rfq-lifecycle/reminders/status
   * Statut des relances
   */
  @Get('reminders/status')
  getReminderStatus() {
    const status = this.reminderService.getReminderStatus();
    return {
      success: true,
      data: status,
    };
  }

  /**
   * POST /rfq-lifecycle/reminders/process
   * Traiter les relances manuellement
   */
  @Post('reminders/process')
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

  /**
   * POST /rfq-lifecycle/reminders/send
   * Envoyer une relance manuelle
   */
  @Post('reminders/send')
  async sendManualReminder(
    @Query('rfqNumber') rfqNumber: string,
    @Query('supplierEmail') supplierEmail: string
  ) {
    if (!rfqNumber || !supplierEmail) {
      return { success: false, error: 'rfqNumber et supplierEmail requis' };
    }

    const success = await this.reminderService.sendManualReminder(rfqNumber, supplierEmail);
    return {
      success,
      message: success ? 'Relance envoyée' : 'Échec de l\'envoi',
    };
  }

  /**
   * GET /rfq-lifecycle/suppliers
   * Liste tous les fournisseurs consultés
   */
  @Get('suppliers')
  getAllSuppliers() {
    const rfqs = this.lifecycleService.getSentRfqs();
    const supplierMap = new Map<string, any>();

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
        if (supplier.status === 'offre_reçue') existing.quotesReceived++;
        if (supplier.status === 'refus') existing.declines++;
        if (supplier.status === 'consulté' || supplier.status === 'relancé') existing.pending++;

        supplierMap.set(supplier.email, existing);
      }
    }

    return {
      success: true,
      count: supplierMap.size,
      data: Array.from(supplierMap.values()),
    };
  }

  /**
   * GET /rfq-lifecycle/dashboard
   * Tableau de bord global
   */
  @Get('dashboard')
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
        if (s.status === 'offre_reçue') stats.suppliersWithQuotes++;
        if (s.status === 'refus') stats.suppliersDeclined++;
        if (s.status === 'consulté' || s.status === 'relancé') stats.suppliersPending++;
      }
    }

    return {
      success: true,
      data: stats,
    };
  }
}
