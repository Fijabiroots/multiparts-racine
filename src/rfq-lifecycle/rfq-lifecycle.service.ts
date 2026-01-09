import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Imap from 'imap';
import { simpleParser } from 'mailparser';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { LogisticsInfo } from './logistics.interface';

/**
 * Structure d'un fournisseur consulté
 */
export interface ConsultedSupplier {
  email: string;
  name?: string;
  consultedAt: Date;
  rfqNumber: string;
  status: 'consulté' | 'offre_reçue' | 'refus' | 'relancé' | 'sans_réponse';
  lastReminderAt?: Date;
  reminderCount: number;
  responseAt?: Date;
  quoteReference?: string;
}

/**
 * Structure d'une demande de prix envoyée
 */
export interface SentRfq {
  internalRfqNumber: string;
  clientRfqNumber?: string;
  subject: string;
  sentAt: Date;
  sentBy: string;
  suppliers: ConsultedSupplier[];
  status: 'envoyé' | 'en_attente' | 'partiellement_répondu' | 'complet' | 'clôturé';
  clientEmail?: string;
  clientName?: string;
  itemCount?: number;
  deadline?: Date;
}

/**
 * Structure d'une offre fournisseur
 */
export interface SupplierQuote {
  supplierEmail: string;
  supplierName?: string;
  rfqNumber: string;
  receivedAt: Date;
  subject: string;
  currency?: string;
  totalAmount?: number;
  deliveryTime?: string;
  paymentTerms?: string;
  validity?: string;
  items: QuoteItem[];
  attachments: string[];
  rawText?: string;
  needsManualReview: boolean;
  
  // Informations logistiques
  logistics?: LogisticsInfo;
}

export interface QuoteItem {
  description: string;
  partNumber?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  deliveryTime?: string;
  notes?: string;
  
  // Logistique par article
  weightKg?: number;
  hsCode?: string;
  countryOfOrigin?: string;
}

@Injectable()
export class RfqLifecycleService {
  private readonly logger = new Logger(RfqLifecycleService.name);
  private readonly dataFilePath: string;
  private sentRfqs: Map<string, SentRfq> = new Map();
  private supplierQuotes: Map<string, SupplierQuote[]> = new Map();

  // Adresses email à surveiller
  private readonly monitoredEmails = [
    'procurement@multipartsci.com',
    'rafiou.oyeossi@multipartsci.com',
  ];

  constructor(private configService: ConfigService) {
    const dataDir = this.configService.get<string>('app.outputDir', './output');
    this.dataFilePath = path.join(dataDir, 'rfq-lifecycle-data.json');
    this.loadData();
  }

  /**
   * Charge les données persistées
   */
  private loadData(): void {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.dataFilePath, 'utf-8'));
        
        // Reconstruire les Maps
        if (data.sentRfqs) {
          this.sentRfqs = new Map(Object.entries(data.sentRfqs));
        }
        if (data.supplierQuotes) {
          this.supplierQuotes = new Map(Object.entries(data.supplierQuotes));
        }
        
        this.logger.log(`Données RFQ lifecycle chargées: ${this.sentRfqs.size} RFQs`);
      }
    } catch (error) {
      this.logger.warn(`Erreur chargement données: ${error.message}`);
    }
  }

  /**
   * Sauvegarde les données
   */
  private saveData(): void {
    try {
      const dir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        sentRfqs: Object.fromEntries(this.sentRfqs),
        supplierQuotes: Object.fromEntries(this.supplierQuotes),
        lastUpdate: new Date().toISOString(),
      };

      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error(`Erreur sauvegarde données: ${error.message}`);
    }
  }

  /**
   * Scanner le dossier Sent pour détecter les demandes envoyées aux fournisseurs
   */
  async scanSentEmails(): Promise<SentRfq[]> {
    const newRfqs: SentRfq[] = [];

    try {
      const imapConfig = this.getImapConfig();
      const imap = new Imap(imapConfig);

      await new Promise<void>((resolve, reject) => {
        imap.once('ready', async () => {
          try {
            const sentFolder = this.configService.get<string>('drafts.sentFolder', 'INBOX.Sent');
            
            imap.openBox(sentFolder, true, async (err, box) => {
              if (err) {
                this.logger.error(`Erreur ouverture dossier Sent: ${err.message}`);
                imap.end();
                resolve();
                return;
              }

              // Chercher les emails envoyés récemment (7 derniers jours)
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

              imap.search([['SINCE', sevenDaysAgo]], (searchErr, results) => {
                if (searchErr || !results || results.length === 0) {
                  imap.end();
                  resolve();
                  return;
                }

                const fetch = imap.fetch(results, { bodies: '', struct: true });
                const emails: any[] = [];

                fetch.on('message', (msg) => {
                  let buffer = '';
                  msg.on('body', (stream) => {
                    stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                  });
                  msg.once('end', () => emails.push(buffer));
                });

                fetch.once('end', async () => {
                  for (const emailBuffer of emails) {
                    try {
                      const parsed = await simpleParser(emailBuffer);
                      const rfq = await this.processOutboundEmail(parsed);
                      if (rfq) {
                        newRfqs.push(rfq);
                      }
                    } catch (e) {
                      // Ignorer les erreurs de parsing individuelles
                    }
                  }
                  imap.end();
                  resolve();
                });
              });
            });
          } catch (e) {
            imap.end();
            reject(e);
          }
        });

        imap.once('error', (err: Error) => {
          this.logger.error(`Erreur IMAP: ${err.message}`);
          resolve();
        });

        imap.connect();
      });

      this.saveData();
      return newRfqs;

    } catch (error) {
      this.logger.error(`Erreur scan emails envoyés: ${error.message}`);
      return [];
    }
  }

  /**
   * Traite un email sortant pour détecter une demande de prix
   */
  private async processOutboundEmail(parsed: any): Promise<SentRfq | null> {
    const from = parsed.from?.text?.toLowerCase() || '';
    const to = parsed.to?.text || '';
    const cc = parsed.cc?.text || '';
    const subject = parsed.subject || '';
    const body = parsed.text || parsed.html || '';
    const messageId = parsed.messageId;

    // Vérifier si c'est un email envoyé par nous
    if (!this.monitoredEmails.some(email => from.includes(email.toLowerCase()))) {
      return null;
    }

    // Détecter si c'est une demande de prix
    const isRfq = this.isRfqEmail(subject, body);
    if (!isRfq) {
      return null;
    }

    // Extraire le numéro RFQ
    const rfqNumber = this.extractRfqNumber(subject, body);
    if (!rfqNumber) {
      return null;
    }

    // Vérifier si déjà enregistré
    if (this.sentRfqs.has(rfqNumber)) {
      // Mettre à jour les fournisseurs consultés
      const existing = this.sentRfqs.get(rfqNumber)!;
      const newSuppliers = this.extractSupplierEmails(to, cc);
      
      for (const supplierEmail of newSuppliers) {
        if (!existing.suppliers.find(s => s.email === supplierEmail)) {
          existing.suppliers.push({
            email: supplierEmail,
            consultedAt: parsed.date || new Date(),
            rfqNumber,
            status: 'consulté',
            reminderCount: 0,
          });
        }
      }
      
      return null; // Déjà existant, mis à jour
    }

    // Extraire les fournisseurs destinataires
    const suppliers = this.extractSupplierEmails(to, cc).map(email => ({
      email,
      consultedAt: parsed.date || new Date(),
      rfqNumber,
      status: 'consulté' as const,
      reminderCount: 0,
    }));

    if (suppliers.length === 0) {
      return null;
    }

    // Créer la nouvelle entrée
    const sentRfq: SentRfq = {
      internalRfqNumber: rfqNumber,
      clientRfqNumber: this.extractClientRfqNumber(subject, body),
      subject,
      sentAt: parsed.date || new Date(),
      sentBy: from,
      suppliers,
      status: 'envoyé',
      itemCount: this.countItems(body),
    };

    // Extraire la deadline si mentionnée
    const deadlineMatch = body.match(/(?:deadline|délai|avant le|before)[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
    if (deadlineMatch) {
      sentRfq.deadline = new Date(deadlineMatch[1]);
    }

    this.sentRfqs.set(rfqNumber, sentRfq);
    this.logger.log(`Nouvelle demande détectée: ${rfqNumber} → ${suppliers.length} fournisseur(s)`);

    return sentRfq;
  }

  /**
   * Détecter si c'est un email de demande de prix
   */
  private isRfqEmail(subject: string, body: string): boolean {
    const combined = (subject + ' ' + body).toLowerCase();
    const rfqKeywords = [
      'demande de prix',
      'demande de cotation',
      'request for quotation',
      'rfq',
      'price request',
      'quotation request',
      'devis',
      'offre de prix',
      'consultation',
    ];
    return rfqKeywords.some(kw => combined.includes(kw));
  }

  /**
   * Extraire le numéro RFQ
   */
  private extractRfqNumber(subject: string, body: string): string | null {
    const combined = subject + ' ' + body;
    const patterns = [
      /RFQ[\s\-_:]*([A-Z0-9\-]+)/i,
      /(?:Réf|Ref|Reference)[:\s]*([A-Z0-9\-]+)/i,
      /(?:N°|No\.?)[:\s]*([A-Z0-9\-]+)/i,
      /PR[\s\-_]*(\d{6,})/i,
    ];

    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Extraire le numéro RFQ client
   */
  private extractClientRfqNumber(subject: string, body: string): string | undefined {
    const combined = subject + ' ' + body;
    const match = combined.match(/(?:client|customer|PR)[:\s\-]*([A-Z0-9\-]+)/i);
    return match ? match[1] : undefined;
  }

  /**
   * Extraire les emails des fournisseurs (exclure nos propres adresses)
   */
  private extractSupplierEmails(to: string, cc: string): string[] {
    const combined = to + ',' + cc;
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/gi;
    const emails = combined.match(emailPattern) || [];
    
    // Filtrer nos propres adresses
    return emails
      .map(e => e.toLowerCase())
      .filter(e => !this.monitoredEmails.some(m => e.includes(m.toLowerCase())))
      .filter(e => !e.includes('multipartsci.com')); // Exclure notre domaine
  }

  /**
   * Compter approximativement le nombre d'items
   */
  private countItems(body: string): number {
    const lines = body.split('\n');
    let count = 0;
    for (const line of lines) {
      if (/^\s*\d+[\.\)]\s+/.test(line) || /^\s*[-•]\s+\w/.test(line)) {
        count++;
      }
    }
    return count || 1;
  }

  /**
   * Obtenir la configuration IMAP
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

  /**
   * Obtenir toutes les demandes envoyées
   */
  getSentRfqs(): SentRfq[] {
    return Array.from(this.sentRfqs.values());
  }

  /**
   * Obtenir une demande par numéro
   */
  getRfqByNumber(rfqNumber: string): SentRfq | undefined {
    return this.sentRfqs.get(rfqNumber);
  }

  /**
   * Obtenir les fournisseurs sans réponse pour les relances
   */
  getSuppliersNeedingReminder(maxReminderCount = 3, minDaysSinceLastContact = 2): ConsultedSupplier[] {
    const suppliers: ConsultedSupplier[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minDaysSinceLastContact);

    for (const rfq of this.sentRfqs.values()) {
      for (const supplier of rfq.suppliers) {
        if (
          supplier.status === 'consulté' || 
          supplier.status === 'relancé' ||
          supplier.status === 'sans_réponse'
        ) {
          const lastContact = supplier.lastReminderAt || supplier.consultedAt;
          if (
            lastContact < cutoffDate && 
            supplier.reminderCount < maxReminderCount
          ) {
            suppliers.push(supplier);
          }
        }
      }
    }

    return suppliers;
  }

  /**
   * Marquer un fournisseur comme relancé
   */
  markSupplierReminded(rfqNumber: string, supplierEmail: string): void {
    const rfq = this.sentRfqs.get(rfqNumber);
    if (rfq) {
      const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
      if (supplier) {
        supplier.status = 'relancé';
        supplier.lastReminderAt = new Date();
        supplier.reminderCount++;
        this.saveData();
      }
    }
  }

  /**
   * Enregistrer une offre fournisseur reçue
   */
  registerSupplierQuote(quote: SupplierQuote): void {
    // Mettre à jour le statut du fournisseur
    const rfq = this.sentRfqs.get(quote.rfqNumber);
    if (rfq) {
      const supplier = rfq.suppliers.find(s => s.email === quote.supplierEmail);
      if (supplier) {
        supplier.status = 'offre_reçue';
        supplier.responseAt = quote.receivedAt;
        supplier.quoteReference = quote.subject;
      }

      // Mettre à jour le statut de la demande
      const respondedCount = rfq.suppliers.filter(s => s.status === 'offre_reçue').length;
      if (respondedCount === rfq.suppliers.length) {
        rfq.status = 'complet';
      } else if (respondedCount > 0) {
        rfq.status = 'partiellement_répondu';
      }
    }

    // Stocker l'offre
    const quotes = this.supplierQuotes.get(quote.rfqNumber) || [];
    quotes.push(quote);
    this.supplierQuotes.set(quote.rfqNumber, quotes);

    this.saveData();
    this.logger.log(`Offre enregistrée: ${quote.supplierEmail} pour ${quote.rfqNumber}`);
  }

  /**
   * Enregistrer un refus de fournisseur
   */
  registerSupplierDecline(rfqNumber: string, supplierEmail: string): void {
    const rfq = this.sentRfqs.get(rfqNumber);
    if (rfq) {
      const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
      if (supplier) {
        supplier.status = 'refus';
        supplier.responseAt = new Date();
        this.saveData();
        this.logger.log(`Refus enregistré: ${supplierEmail} pour ${rfqNumber}`);
      }
    }
  }

  /**
   * Obtenir les offres pour un RFQ
   */
  getQuotesForRfq(rfqNumber: string): SupplierQuote[] {
    return this.supplierQuotes.get(rfqNumber) || [];
  }
}
