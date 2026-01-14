import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AutoEmailType } from '../interfaces/reminder.interfaces';
import { ReminderDatabaseService } from './reminder-database.service';

export interface SendAutoEmailOptions {
  type: AutoEmailType;
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
  requestId?: string;
  rfqId?: string;
  internalRfqNumber?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * ReminderMailService
 *
 * Handles sending automatic emails for the reminder module.
 * Adds required headers (X-Multiparts-Auto, Auto-Submitted) for loop prevention.
 */
@Injectable()
export class ReminderMailService {
  private readonly logger = new Logger(ReminderMailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly ackFromEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly reminderDbService: ReminderDatabaseService,
  ) {
    this.ackFromEmail = this.configService.get<string>('reminder.multipartsAckFrom') || 'rafiou.oyeossi@multipartsci.com';
    this.initTransporter();
  }

  private initTransporter() {
    const smtpConfig = this.configService.get('smtp');

    if (!smtpConfig?.host) {
      this.logger.warn('SMTP not configured - email sending disabled');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port || 587,
        secure: smtpConfig.secure || false,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.password,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

      this.logger.log(`SMTP transporter initialized: ${smtpConfig.host}:${smtpConfig.port}`);
    } catch (error) {
      this.logger.error(`Failed to initialize SMTP transporter: ${error.message}`);
    }
  }

  /**
   * Send an automatic email with proper headers for loop prevention.
   */
  async sendAutoEmail(options: SendAutoEmailOptions): Promise<SendResult> {
    if (!this.transporter) {
      this.logger.error('SMTP transporter not initialized');

      // Log the attempt
      await this.reminderDbService.logAutoEmailEvent({
        type: options.type,
        requestId: options.requestId,
        rfqId: options.rfqId,
        internalRfqNumber: options.internalRfqNumber,
        recipientEmail: options.to,
        senderEmail: options.from,
        subject: options.subject,
        status: 'failed',
        errorMessage: 'SMTP not configured',
      });

      return { success: false, error: 'SMTP not configured' };
    }

    // Build email headers
    const headers: Record<string, string> = {
      'X-Multiparts-Auto': '1',
      'Auto-Submitted': 'auto-replied',
      'X-Auto-Response-Suppress': 'All',
    };

    if (options.inReplyTo) {
      headers['In-Reply-To'] = options.inReplyTo;
    }

    if (options.references && options.references.length > 0) {
      headers['References'] = options.references.join(' ');
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: `"MULTIPARTS - Rafiou OYEOSSI" <${options.from}>`,
      replyTo: options.from,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: this.textToHtml(options.body),
      headers,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(
        `Auto email sent [${options.type}] to ${options.to}: ${info.messageId}`,
      );

      // Log success
      await this.reminderDbService.logAutoEmailEvent({
        type: options.type,
        requestId: options.requestId,
        rfqId: options.rfqId,
        internalRfqNumber: options.internalRfqNumber,
        recipientEmail: options.to,
        senderEmail: options.from,
        subject: options.subject,
        messageId: info.messageId,
        status: 'sent',
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send auto email [${options.type}] to ${options.to}: ${error.message}`,
      );

      // Log failure
      await this.reminderDbService.logAutoEmailEvent({
        type: options.type,
        requestId: options.requestId,
        rfqId: options.rfqId,
        internalRfqNumber: options.internalRfqNumber,
        recipientEmail: options.to,
        senderEmail: options.from,
        subject: options.subject,
        status: 'failed',
        errorMessage: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send supplier follow-up reminder.
   */
  async sendSupplierReminder(options: {
    supplierEmail: string;
    internalRfqNumber: string;
    originalSubject: string;
    reminderCount: number;
    requestId?: string;
  }): Promise<SendResult> {
    const urgency = this.getReminderUrgency(options.reminderCount);
    const subject = `${urgency}Relance: ${options.originalSubject}`;

    const body = this.buildSupplierReminderBody(
      options.internalRfqNumber,
      options.reminderCount,
    );

    return this.sendAutoEmail({
      type: 'SUPPLIER_FOLLOW_UP_REMINDER',
      from: this.ackFromEmail,
      to: options.supplierEmail,
      subject,
      body,
      requestId: options.requestId,
      internalRfqNumber: options.internalRfqNumber,
    });
  }

  /**
   * Convert plain text to simple HTML
   */
  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5;">
${escaped}
</body>
</html>`;
  }

  /**
   * Build supplier reminder body based on reminder count
   */
  private buildSupplierReminderBody(
    internalRfqNumber: string,
    reminderCount: number,
  ): string {
    if (reminderCount === 0) {
      return `Bonjour,

Nous vous relançons concernant notre demande de prix (Réf. ${internalRfqNumber}).

Nous restons dans l'attente de votre proposition.

Cordialement,
MULTIPARTS – Rafiou OYEOSSI`;
    }

    if (reminderCount === 1) {
      return `Bonjour,

Ceci est notre ${reminderCount + 1}ème relance concernant notre demande de prix (Réf. ${internalRfqNumber}).

Merci de nous faire parvenir votre meilleure offre dans les meilleurs délais.

Cordialement,
MULTIPARTS – Rafiou OYEOSSI`;
    }

    return `Bonjour,

URGENT - ${reminderCount + 1}ème relance concernant notre demande de prix (Réf. ${internalRfqNumber}).

Nous n'avons toujours pas reçu votre proposition. Merci de nous confirmer si vous êtes en mesure de répondre à cette demande.

Cordialement,
MULTIPARTS – Rafiou OYEOSSI`;
  }

  /**
   * Get urgency prefix based on reminder count
   */
  private getReminderUrgency(reminderCount: number): string {
    if (reminderCount === 0) return '';
    if (reminderCount === 1) return '[Rappel] ';
    if (reminderCount === 2) return '[2ème Rappel] ';
    return '[URGENT] ';
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return false;

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified');
      return true;
    } catch (error) {
      this.logger.error(`SMTP verification failed: ${error.message}`);
      return false;
    }
  }
}
