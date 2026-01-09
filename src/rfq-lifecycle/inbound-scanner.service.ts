import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as Imap from 'imap';
import { simpleParser } from 'mailparser';
import { RfqLifecycleService, SupplierQuote } from './rfq-lifecycle.service';
import { QuoteComparisonService } from './quote-comparison.service';
import { WebhookService } from '../webhook/webhook.service';
import { BrandIntelligenceService } from '../brand-intelligence/brand-intelligence.service';

@Injectable()
export class InboundScannerService {
  private readonly logger = new Logger(InboundScannerService.name);

  // Adresses email à surveiller pour les réponses
  private readonly monitoredInboxes = [
    'procurement@multipartsci.com',
    'rafiou.oyeossi@multipartsci.com',
  ];

  // Mots-clés indiquant un refus
  private readonly declineKeywords = [
    'ne sommes pas en mesure',
    'pas en mesure de répondre',
    'déclinons',
    'refusons',
    'cannot quote',
    'unable to quote',
    'not able to provide',
    'regret to inform',
    'pas disponible',
    'not available',
    'hors stock',
    'out of stock',
    'ne fabriquons plus',
    'discontinued',
  ];

  constructor(
    private configService: ConfigService,
    private rfqLifecycleService: RfqLifecycleService,
    private quoteComparisonService: QuoteComparisonService,
    private webhookService: WebhookService,
    private brandIntelligence: BrandIntelligenceService,
  ) {}

  /**
   * Tâche planifiée: Scanner les emails entrants
   * Exécutée toutes les 10 minutes
   */
  @Cron('*/10 * * * *')
  async scheduledInboundScan(): Promise<void> {
    this.logger.log('📥 Scan des emails entrants pour réponses fournisseurs...');
    await this.scanInboundEmails();
  }

  /**
   * Scanner les emails entrants pour détecter les réponses fournisseurs
   */
  async scanInboundEmails(): Promise<{ quotes: number; declines: number }> {
    let quotesCount = 0;
    let declinesCount = 0;

    try {
      const imapConfig = this.getImapConfig();
      const imap = new Imap(imapConfig);

      await new Promise<void>((resolve, reject) => {
        imap.once('ready', () => {
          imap.openBox('INBOX', false, async (err, box) => {
            if (err) {
              this.logger.error(`Erreur ouverture INBOX: ${err.message}`);
              imap.end();
              resolve();
              return;
            }

            // Chercher les emails non lus des 7 derniers jours
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            imap.search([['SINCE', sevenDaysAgo], 'UNSEEN'], async (searchErr, results) => {
              if (searchErr || !results || results.length === 0) {
                this.logger.debug('Aucun nouvel email à traiter');
                imap.end();
                resolve();
                return;
              }

              this.logger.log(`${results.length} email(s) non lu(s) à analyser`);

              const fetch = imap.fetch(results, { 
                bodies: '', 
                struct: true,
                markSeen: false // Ne pas marquer comme lu automatiquement
              });

              const emails: { uid: number; buffer: string }[] = [];

              fetch.on('message', (msg, seqno) => {
                let buffer = '';
                let uid: number;
                
                msg.on('body', (stream) => {
                  stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                });
                
                msg.once('attributes', (attrs) => {
                  uid = attrs.uid;
                });
                
                msg.once('end', () => {
                  emails.push({ uid, buffer });
                });
              });

              fetch.once('end', async () => {
                for (const { uid, buffer } of emails) {
                  try {
                    const parsed = await simpleParser(buffer);
                    const result = await this.processInboundEmail(parsed, imap, uid);
                    
                    if (result === 'quote') quotesCount++;
                    if (result === 'decline') declinesCount++;
                    
                  } catch (e) {
                    this.logger.debug(`Erreur traitement email: ${e.message}`);
                  }
                }
                imap.end();
                resolve();
              });
            });
          });
        });

        imap.once('error', (err: Error) => {
          this.logger.error(`Erreur IMAP: ${err.message}`);
          resolve();
        });

        imap.connect();
      });

    } catch (error) {
      this.logger.error(`Erreur scan emails entrants: ${error.message}`);
    }

    if (quotesCount > 0 || declinesCount > 0) {
      this.logger.log(`📊 Résultat scan: ${quotesCount} offre(s), ${declinesCount} refus`);
    }

    return { quotes: quotesCount, declines: declinesCount };
  }

  /**
   * Traiter un email entrant
   */
  private async processInboundEmail(
    parsed: any, 
    imap: Imap, 
    uid: number
  ): Promise<'quote' | 'decline' | 'ignored' | null> {
    
    const from = parsed.from?.text?.toLowerCase() || '';
    const to = parsed.to?.text?.toLowerCase() || '';
    const subject = parsed.subject || '';
    const body = parsed.text || parsed.html || '';
    const attachments = parsed.attachments || [];

    // Vérifier si c'est une réponse à une de nos demandes
    // 1. Chercher le RFQ dans le sujet ou le corps
    const rfqNumber = this.findRfqReference(subject, body);
    if (!rfqNumber) {
      return 'ignored';
    }

    // 2. Vérifier si l'expéditeur est un fournisseur consulté
    const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
    if (!rfq) {
      return 'ignored';
    }

    const supplierEmail = this.extractEmail(from);
    const isKnownSupplier = rfq.suppliers.some(s => 
      s.email.toLowerCase() === supplierEmail ||
      supplierEmail.includes(s.email.split('@')[0])
    );

    if (!isKnownSupplier) {
      // Peut-être un nouveau fournisseur qui répond
      this.logger.debug(`Email de ${supplierEmail} pour ${rfqNumber} - fournisseur non reconnu`);
    }

    // Détecter les marques dans la demande originale et la réponse
    const detectedBrands = this.brandIntelligence.detectBrands(
      `${rfq.subject} ${body}`
    );

    // 3. Détecter si c'est un refus
    const isDecline = this.isDeclineEmail(subject, body);
    if (isDecline) {
      this.rfqLifecycleService.registerSupplierDecline(rfqNumber, supplierEmail);
      
      // Enregistrer la relation fournisseur-marque (refus)
      if (detectedBrands.length > 0) {
        await this.brandIntelligence.recordSupplierResponse(
          supplierEmail,
          undefined, // Pas de nom connu
          detectedBrands,
          false, // isQuote = false (refus)
        );
        this.logger.log(`📊 Refus enregistré: ${supplierEmail} -> ${detectedBrands.join(', ')}`);
      }
      
      // Émettre webhook: Fournisseur a décliné
      await this.webhookService.emitQuoteDeclined(rfqNumber, supplierEmail);
      
      // Marquer l'email comme lu
      imap.addFlags(uid, ['\\Seen'], () => {});
      
      return 'decline';
    }

    // 4. C'est potentiellement une offre - extraire les données
    const quote = await this.extractQuoteData(parsed, supplierEmail, rfqNumber);
    
    if (quote) {
      this.rfqLifecycleService.registerSupplierQuote(quote);
      
      // Enregistrer la relation fournisseur-marque (offre)
      if (detectedBrands.length > 0) {
        await this.brandIntelligence.recordSupplierResponse(
          supplierEmail,
          quote.supplierName,
          detectedBrands,
          true, // isQuote = true (offre)
          quote.totalAmount !== undefined && quote.totalAmount > 0, // hasPrice
        );
        this.logger.log(`📊 Offre enregistrée: ${supplierEmail} -> ${detectedBrands.join(', ')}`);
      }
      
      // Émettre webhook: Offre reçue
      await this.webhookService.emitQuoteReceived(
        rfqNumber,
        supplierEmail,
        quote.supplierName,
        quote.totalAmount,
        quote.currency
      );
      
      // Générer/mettre à jour le comparatif
      await this.checkAndGenerateComparison(rfqNumber, rfq.subject, quote);
      
      // Marquer l'email comme lu
      imap.addFlags(uid, ['\\Seen'], () => {});
      
      return 'quote';
    }

    return 'ignored';
  }

  /**
   * Trouver la référence RFQ dans le texte
   */
  private findRfqReference(subject: string, body: string): string | null {
    const combined = subject + ' ' + body;
    
    // Patterns pour trouver la référence
    const patterns = [
      /RFQ[\s\-_:]*([A-Z0-9\-]+)/i,
      /(?:Réf|Ref|Reference)[:\s]*([A-Z0-9\-]+)/i,
      /(?:N°|No\.?)[:\s]*([A-Z0-9\-]+)/i,
      /PR[\s\-_]*(\d{6,})/i,
      /(?:votre\s+demande|your\s+request)[^\d]*([A-Z0-9\-]+)/i,
    ];

    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match) {
        const rfqNumber = match[1];
        // Vérifier si ce RFQ existe
        if (this.rfqLifecycleService.getRfqByNumber(rfqNumber)) {
          return rfqNumber;
        }
      }
    }

    // Chercher dans tous les RFQ existants
    for (const rfq of this.rfqLifecycleService.getSentRfqs()) {
      if (combined.includes(rfq.internalRfqNumber)) {
        return rfq.internalRfqNumber;
      }
      if (rfq.clientRfqNumber && combined.includes(rfq.clientRfqNumber)) {
        return rfq.internalRfqNumber;
      }
    }

    return null;
  }

  /**
   * Détecter si c'est un email de refus
   */
  private isDeclineEmail(subject: string, body: string): boolean {
    const combined = (subject + ' ' + body).toLowerCase();
    return this.declineKeywords.some(kw => combined.includes(kw));
  }

  /**
   * Extraire les données de l'offre
   */
  private async extractQuoteData(
    parsed: any, 
    supplierEmail: string, 
    rfqNumber: string
  ): Promise<SupplierQuote | null> {
    
    const attachments = parsed.attachments || [];
    const body = parsed.text || parsed.html || '';
    let quote: SupplierQuote | null = null;

    // 1. Chercher dans les pièces jointes Excel
    for (const att of attachments) {
      const filename = att.filename?.toLowerCase() || '';
      if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        try {
          quote = await this.quoteComparisonService.parseExcelQuote(
            att.content, 
            supplierEmail, 
            rfqNumber
          );
          quote.attachments.push(filename);
          quote.subject = parsed.subject;
          quote.supplierName = this.extractName(parsed.from?.text);
          
          if (!quote.needsManualReview && quote.items.length > 0) {
            return quote;
          }
        } catch (e) {
          this.logger.debug(`Erreur parsing Excel ${filename}: ${e.message}`);
        }
      }
    }

    // 2. Chercher dans les pièces jointes PDF
    for (const att of attachments) {
      const filename = att.filename?.toLowerCase() || '';
      if (filename.endsWith('.pdf')) {
        try {
          const pdfQuote = await this.quoteComparisonService.parsePdfQuote(
            att.content, 
            supplierEmail, 
            rfqNumber
          );
          pdfQuote.attachments.push(filename);
          pdfQuote.subject = parsed.subject;
          pdfQuote.supplierName = this.extractName(parsed.from?.text);
          
          // Fusionner avec quote existant ou utiliser celui-ci
          if (!quote || (pdfQuote.items.length > quote.items.length)) {
            quote = pdfQuote;
          }
        } catch (e) {
          this.logger.debug(`Erreur parsing PDF ${filename}: ${e.message}`);
        }
      }
    }

    // 3. Extraire depuis le corps de l'email
    if (!quote || quote.items.length === 0) {
      quote = this.quoteComparisonService.parseEmailBodyQuote(body, supplierEmail, rfqNumber);
      quote.subject = parsed.subject;
      quote.supplierName = this.extractName(parsed.from?.text);
    }

    // Retourner l'offre si elle contient des données utiles
    if (quote && (quote.items.length > 0 || quote.totalAmount)) {
      return quote;
    }

    // Créer une offre minimale pour signaler qu'une réponse a été reçue
    return {
      supplierEmail,
      rfqNumber,
      receivedAt: parsed.date || new Date(),
      subject: parsed.subject || '',
      supplierName: this.extractName(parsed.from?.text),
      items: [],
      attachments: attachments.map((a: any) => a.filename || 'attachment'),
      rawText: body.substring(0, 2000),
      needsManualReview: true,
    };
  }

  /**
   * Ajouter l'offre au comparatif et vérifier si complet
   */
  private async checkAndGenerateComparison(
    rfqNumber: string, 
    rfqSubject?: string,
    newQuote?: SupplierQuote
  ): Promise<void> {
    const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
    if (!rfq) return;

    try {
      // Ajouter/mettre à jour l'offre dans le comparatif
      if (newQuote) {
        const comparison = await this.quoteComparisonService.addOrUpdateQuote(
          rfqNumber,
          newQuote,
          rfqSubject || rfq.subject,
          rfq.clientRfqNumber
        );
        
        this.logger.log(`📊 Comparatif mis à jour: ${comparison.filePath} (${comparison.suppliers.length} fournisseur(s))`);
      }

      // Compter les réponses
      const responded = rfq.suppliers.filter(s => 
        s.status === 'offre_reçue' || s.status === 'refus'
      ).length;

      // Émettre webhook si toutes les offres sont reçues
      if (responded === rfq.suppliers.length && rfq.suppliers.length > 0) {
        const comparison = this.quoteComparisonService.getExistingComparison(rfqNumber);
        if (comparison) {
          await this.webhookService.emitComparisonComplete(
            rfqNumber,
            comparison.filePath,
            comparison.recommendation
          );
          this.logger.log(`✅ Comparatif complet: ${rfqNumber} - Tous les fournisseurs ont répondu`);
        }
      }
    } catch (error) {
      this.logger.error(`Erreur génération comparatif: ${error.message}`);
    }
  }

  /**
   * Extraire l'email d'une chaîne
   */
  private extractEmail(text: string): string {
    const match = text.match(/<([^>]+)>/) || text.match(/([\w.-]+@[\w.-]+\.\w+)/);
    return match ? match[1].toLowerCase() : text.toLowerCase();
  }

  /**
   * Extraire le nom d'une adresse email formatée
   */
  private extractName(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const match = text.match(/^"?([^"<]+)"?\s*</);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Configuration IMAP
   */
  private getImapConfig(): Imap.Config {
    return {
      user: this.configService.get<string>('imap.user')!,
      password: this.configService.get<string>('imap.password')!,
      host: this.configService.get<string>('imap.host')!,
      port: this.configService.get<number>('imap.port')!,
      tls: this.configService.get<boolean>('imap.tls', true),
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    };
  }
}
