import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import { RfqLifecycleService, ConsultedSupplier, SentRfq } from './rfq-lifecycle.service';
import { WebhookService, WebhookEventType } from '../webhook/webhook.service';
import { COMPANY_INFO, getEmailSignature } from '../common/company-info';

export interface ReminderConfig {
  enabled: boolean;
  maxReminders: number;
  daysBetweenReminders: number;
  reminderTimes: string[]; // Heures d'envoi (ex: ['09:00', '14:00'])
}

export interface ReminderResult {
  supplierEmail: string;
  rfqNumber: string;
  success: boolean;
  reminderCount: number;
  error?: string;
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private transporter: nodemailer.Transporter;
  private signature: string = '';

  constructor(
    private configService: ConfigService,
    private rfqLifecycleService: RfqLifecycleService,
    private webhookService: WebhookService,
  ) {
    this.initializeTransporter();
    this.loadSignature();
  }

  private initializeTransporter(): void {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure: this.configService.get<boolean>('smtp.secure', false),
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.password'),
      },
    });
  }

  private loadSignature(): void {
    const sigPath = this.configService.get<string>('email.defaultSignaturePath', './signature.html');
    if (fs.existsSync(sigPath)) {
      this.signature = fs.readFileSync(sigPath, 'utf-8');
    } else {
      // Utiliser la signature par défaut de l'entreprise
      const c = COMPANY_INFO.contact;
      const addr = COMPANY_INFO.address;
      this.signature = `
<br>--<br>
<b>${c.name}</b><br>
${c.title}<br>
<b>${COMPANY_INFO.name}</b><br><br>
${addr.line1}<br>
${addr.line2}<br>
${addr.city}, ${addr.country}<br><br>
Tél: ${c.phone}<br>
Mobile: ${c.mobile}<br>
Email: <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
`;
    }
  }

  /**
   * Tâche planifiée: Vérifier et envoyer les relances
   * Exécutée 2 fois par jour (9h et 14h)
   */
  @Cron('0 9,14 * * 1-5') // Lun-Ven à 9h et 14h
  async scheduledReminderCheck(): Promise<void> {
    const enabled = this.configService.get<boolean>('reminder.enabled', true);
    if (!enabled) {
      return;
    }

    this.logger.log('🔔 Vérification des relances automatiques...');
    await this.processReminders();
  }

  /**
   * Traiter toutes les relances nécessaires
   */
  async processReminders(): Promise<ReminderResult[]> {
    const results: ReminderResult[] = [];
    
    const maxReminders = this.configService.get<number>('reminder.maxReminders', 3);
    const daysBetween = this.configService.get<number>('reminder.daysBetweenReminders', 2);
    
    // Obtenir les fournisseurs à relancer
    const suppliersToRemind = this.rfqLifecycleService.getSuppliersNeedingReminder(
      maxReminders,
      daysBetween
    );

    this.logger.log(`${suppliersToRemind.length} fournisseur(s) à relancer`);

    for (const supplier of suppliersToRemind) {
      try {
        // Récupérer les infos de la demande
        const rfq = this.rfqLifecycleService.getRfqByNumber(supplier.rfqNumber);
        if (!rfq) continue;

        // Envoyer la relance
        const success = await this.sendReminder(supplier, rfq);
        
        if (success) {
          // Mettre à jour le statut
          this.rfqLifecycleService.markSupplierReminded(supplier.rfqNumber, supplier.email);
          
          // Émettre webhook: Relance envoyée
          await this.webhookService.emitReminderSent(
            supplier.rfqNumber,
            supplier.email,
            supplier.reminderCount + 1
          );
          
          // Vérifier si max atteint
          if (supplier.reminderCount + 1 >= maxReminders) {
            await this.webhookService.emit(WebhookEventType.REMINDER_MAX_REACHED, {
              rfqNumber: supplier.rfqNumber,
              supplierEmail: supplier.email,
              reminderCount: supplier.reminderCount + 1,
              maxReminders,
            }, { rfqNumber: supplier.rfqNumber, supplierEmail: supplier.email });
          }
        } else {
          // Émettre webhook: Échec relance
          await this.webhookService.emit(WebhookEventType.REMINDER_FAILED, {
            rfqNumber: supplier.rfqNumber,
            supplierEmail: supplier.email,
            error: 'Échec envoi',
          }, { rfqNumber: supplier.rfqNumber, supplierEmail: supplier.email });
        }

        results.push({
          supplierEmail: supplier.email,
          rfqNumber: supplier.rfqNumber,
          success,
          reminderCount: supplier.reminderCount + 1,
        });

      } catch (error) {
        this.logger.error(`Erreur relance ${supplier.email}: ${error.message}`);
        results.push({
          supplierEmail: supplier.email,
          rfqNumber: supplier.rfqNumber,
          success: false,
          reminderCount: supplier.reminderCount,
          error: error.message,
        });
      }

      // Petit délai entre les envois
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (results.length > 0) {
      const successCount = results.filter(r => r.success).length;
      this.logger.log(`✅ Relances: ${successCount}/${results.length} envoyées`);
    }

    return results;
  }

  /**
   * Envoyer une relance à un fournisseur
   */
  async sendReminder(supplier: ConsultedSupplier, rfq: SentRfq): Promise<boolean> {
    try {
      const isFirstReminder = supplier.reminderCount === 0;
      const isUrgent = rfq.deadline && new Date(rfq.deadline) < new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      // Générer le contenu
      const { subject, htmlBody, textBody } = this.generateReminderContent(
        supplier,
        rfq,
        isFirstReminder,
        isUrgent || false
      );

      // Envoyer l'email
      const mailOptions: nodemailer.SendMailOptions = {
        from: this.configService.get<string>('smtp.from', 'procurement@multipartsci.com'),
        to: supplier.email,
        subject,
        text: textBody,
        html: htmlBody,
        replyTo: this.configService.get<string>('smtp.replyTo', 'procurement@multipartsci.com'),
      };

      await this.transporter.sendMail(mailOptions);
      
      this.logger.log(`📧 Relance #${supplier.reminderCount + 1} envoyée à ${supplier.email} pour ${rfq.internalRfqNumber}`);
      return true;

    } catch (error) {
      this.logger.error(`Erreur envoi relance: ${error.message}`);
      return false;
    }
  }

  /**
   * Générer le contenu de l'email de relance
   */
  private generateReminderContent(
    supplier: ConsultedSupplier,
    rfq: SentRfq,
    isFirstReminder: boolean,
    isUrgent: boolean
  ): { subject: string; htmlBody: string; textBody: string } {
    
    const reminderNumber = supplier.reminderCount + 1;
    const urgentPrefix = isUrgent ? '⚠️ URGENT - ' : '';
    const reminderPrefix = isFirstReminder ? 'Relance: ' : `Relance ${reminderNumber}: `;
    
    const subject = `${urgentPrefix}${reminderPrefix}${rfq.subject}`;

    const consultedDate = new Date(supplier.consultedAt).toLocaleDateString('fr-FR');
    const daysSince = Math.floor((Date.now() - new Date(supplier.consultedAt).getTime()) / (1000 * 60 * 60 * 24));
    
    const deadlineText = rfq.deadline 
      ? `<p style="color: #d9534f;"><strong>Date limite de réponse: ${new Date(rfq.deadline).toLocaleDateString('fr-FR')}</strong></p>`
      : '';

    const urgentText = isUrgent
      ? `<p style="color: #d9534f; font-weight: bold;">⚠️ Cette demande est urgente et nécessite une réponse rapide.</p>`
      : '';

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #f0ad4e; padding-bottom: 10px; margin-bottom: 20px; }
    .highlight { background-color: #fcf8e3; padding: 15px; border-left: 4px solid #f0ad4e; margin: 15px 0; }
    .urgent { color: #d9534f; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="color: #f0ad4e; margin: 0;">🔔 Relance - Demande de Prix</h2>
    </div>
    
    <p>Bonjour,</p>
    
    <p>Nous nous permettons de vous relancer concernant notre demande de prix envoyée le <strong>${consultedDate}</strong> (il y a ${daysSince} jours).</p>
    
    <div class="highlight">
      <strong>📋 Référence de la demande:</strong><br>
      • N° Interne: ${rfq.internalRfqNumber}<br>
      ${rfq.clientRfqNumber ? `• N° Client: ${rfq.clientRfqNumber}<br>` : ''}
      • Objet: ${rfq.subject}<br>
      ${rfq.itemCount ? `• Nombre d'articles: ${rfq.itemCount}<br>` : ''}
    </div>
    
    ${urgentText}
    ${deadlineText}
    
    <p>Nous serions reconnaissants si vous pouviez nous faire parvenir votre offre dans les meilleurs délais, ou nous informer si vous n'êtes pas en mesure de répondre à cette demande.</p>
    
    <p>En cas de difficulté ou pour toute question, n'hésitez pas à nous contacter.</p>
    
    <p>Dans l'attente de votre retour, nous vous prions d'agréer nos salutations distinguées.</p>
    
    ${this.signature}
  </div>
</body>
</html>`;

    const textBody = `
RELANCE - DEMANDE DE PRIX

Bonjour,

Nous nous permettons de vous relancer concernant notre demande de prix envoyée le ${consultedDate} (il y a ${daysSince} jours).

RÉFÉRENCE DE LA DEMANDE:
- N° Interne: ${rfq.internalRfqNumber}
${rfq.clientRfqNumber ? `- N° Client: ${rfq.clientRfqNumber}` : ''}
- Objet: ${rfq.subject}
${rfq.itemCount ? `- Nombre d'articles: ${rfq.itemCount}` : ''}

${isUrgent ? '⚠️ Cette demande est urgente et nécessite une réponse rapide.\n' : ''}
${rfq.deadline ? `Date limite de réponse: ${new Date(rfq.deadline).toLocaleDateString('fr-FR')}\n` : ''}

Nous serions reconnaissants si vous pouviez nous faire parvenir votre offre dans les meilleurs délais, ou nous informer si vous n'êtes pas en mesure de répondre à cette demande.

En cas de difficulté ou pour toute question, n'hésitez pas à nous contacter.

Dans l'attente de votre retour, nous vous prions d'agréer nos salutations distinguées.

--
Service Approvisionnement
MULTIPARTS CI
procurement@multipartsci.com
`;

    return { subject, htmlBody, textBody };
  }

  /**
   * Envoyer une relance manuelle
   */
  async sendManualReminder(rfqNumber: string, supplierEmail: string): Promise<boolean> {
    const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
    if (!rfq) {
      this.logger.warn(`RFQ ${rfqNumber} non trouvé`);
      return false;
    }

    const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
    if (!supplier) {
      this.logger.warn(`Fournisseur ${supplierEmail} non trouvé pour ${rfqNumber}`);
      return false;
    }

    return this.sendReminder(supplier, rfq);
  }

  /**
   * Obtenir le statut des relances
   */
  getReminderStatus(): {
    pendingReminders: number;
    sentToday: number;
    suppliersWithoutResponse: ConsultedSupplier[];
  } {
    const maxReminders = this.configService.get<number>('reminder.maxReminders', 3);
    const daysBetween = this.configService.get<number>('reminder.daysBetweenReminders', 2);
    
    const pending = this.rfqLifecycleService.getSuppliersNeedingReminder(maxReminders, daysBetween);
    
    // Compter les envois du jour
    let sentToday = 0;
    const today = new Date().toDateString();
    
    for (const rfq of this.rfqLifecycleService.getSentRfqs()) {
      for (const s of rfq.suppliers) {
        if (s.lastReminderAt && new Date(s.lastReminderAt).toDateString() === today) {
          sentToday++;
        }
      }
    }

    return {
      pendingReminders: pending.length,
      sentToday,
      suppliersWithoutResponse: pending,
    };
  }
}
