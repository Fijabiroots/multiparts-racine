import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as imapSimple from 'imap-simple';
import * as fs from 'fs';
import * as path from 'path';

interface SendMailOptions {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }>;
}

interface SendMailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.initTransporter();
  }

  private initTransporter() {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure: this.configService.get<boolean>('smtp.secure'),
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.password'),
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    this.logger.log('Transporteur SMTP initialisé');
  }

  private getImapConfig(): imapSimple.ImapSimpleOptions {
    return {
      imap: {
        host: this.configService.get<string>('imap.host'),
        port: this.configService.get<number>('imap.port'),
        user: this.configService.get<string>('imap.user'),
        password: this.configService.get<string>('imap.password'),
        tls: this.configService.get<boolean>('imap.tls'),
        authTimeout: this.configService.get<number>('imap.authTimeout'),
        tlsOptions: this.configService.get('imap.tlsOptions'),
      },
    };
  }

  async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    try {
      const fromEmail = this.configService.get<string>('smtp.user');

      // Préparer les pièces jointes
      const attachments = options.attachments?.map(att => {
        if (att.path) {
          return {
            filename: att.filename,
            path: att.path,
            contentType: att.contentType,
          };
        }
        return {
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || 'application/octet-stream',
        };
      });

      const mailOptions: nodemailer.SendMailOptions = {
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        text: options.body,
        html: options.htmlBody || this.textToHtml(options.body),
        attachments,
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(`Email envoyé à ${options.to}: ${info.messageId}`);

      // Copier l'email dans le dossier Sent via IMAP
      try {
        await this.copyToSentFolder(mailOptions);
        this.logger.log(`Email copié dans le dossier Sent`);
      } catch (imapError) {
        this.logger.warn(`Impossible de copier dans Sent: ${imapError.message}`);
        // Ne pas échouer l'envoi si la copie IMAP échoue
      }

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      this.logger.error(`Erreur envoi email à ${options.to}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Copie l'email envoyé dans le dossier Sent via IMAP
   */
  private async copyToSentFolder(mailOptions: nodemailer.SendMailOptions): Promise<void> {
    let connection: imapSimple.ImapSimple | null = null;
    
    try {
      connection = await imapSimple.connect(this.getImapConfig());
      
      // Dossier Sent configuré ou par défaut
      // Note: Certains serveurs utilisent "/" comme séparateur, d'autres "."
      const configuredSentFolder = this.configService.get<string>('drafts.sentFolder');
      const sentFolderNames = configuredSentFolder 
        ? [configuredSentFolder]
        : [
            'INBOX.Sent',        // Format avec point (prioritaire)
            'INBOX/Sent',        // Format avec slash
            'Sent',              // Racine
            'INBOX.Envoyés',     // Français avec point
            'INBOX/Envoyés',     // Français avec slash
            'Envoyés',           // Racine français
            'Sent Items',        // Outlook style
            'INBOX.Sent Items',
            'INBOX/Sent Items',
            'Sent Messages',
            'INBOX.Sent Messages',
          ];
      
      let sentFolder: string | null = null;

      // Chercher le dossier Sent existant
      for (const name of sentFolderNames) {
        try {
          await connection.openBox(name);
          sentFolder = name;
          this.logger.debug(`Dossier Sent trouvé: ${name}`);
          break;
        } catch (err) {
          this.logger.debug(`Dossier ${name} non trouvé, essai suivant...`);
        }
      }

      if (!sentFolder) {
        this.logger.warn(`Aucun dossier Sent trouvé parmi: ${sentFolderNames.join(', ')}`);
        return;
      }

      // Créer le message MIME
      const mimeMessage = await this.createMimeMessageFromOptions(mailOptions);

      // Ajouter le message au dossier Sent avec le flag \Seen
      await new Promise<void>((resolve, reject) => {
        (connection as any).imap.append(
          mimeMessage,
          {
            mailbox: sentFolder,
            flags: ['\\Seen'],
          },
          (err: Error | null) => {
            if (err) {
              this.logger.error(`Erreur append dans ${sentFolder}: ${err.message}`);
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });

      this.logger.log(`Email copié dans ${sentFolder}`);

    } catch (error) {
      this.logger.error(`Erreur copie vers Sent: ${error.message}`);
      throw error;
    } finally {
      if (connection) {
        try {
          connection.end();
        } catch (e) {
          // Ignorer les erreurs de fermeture
        }
      }
    }
  }

  private async createMimeMessageFromOptions(mailOptions: nodemailer.SendMailOptions): Promise<string> {
    const transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
    });

    return new Promise((resolve, reject) => {
      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          reject(err);
          return;
        }

        const chunks: Buffer[] = [];
        const stream = info.message as NodeJS.ReadableStream;
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          const message = Buffer.concat(chunks).toString();
          // Ajouter la date au format IMAP
          const dateHeader = `Date: ${new Date().toUTCString()}\r\n`;
          const finalMessage = dateHeader + message;
          resolve(finalMessage);
        });
        stream.on('error', reject);
      });
    });
  }

  async sendPriceRequestEmail(draft: {
    recipient: string;
    subject: string;
    internalRfqNumber: string;
    clientRfqNumber?: string;
    clientName?: string;
    clientEmail?: string;
    excelPath: string;
    attachmentPaths?: string[];
    responseDeadlineHours?: number;
  }): Promise<SendMailResult> {
    const responseHours = draft.responseDeadlineHours || 24;
    const deadlineDate = new Date();
    deadlineDate.setHours(deadlineDate.getHours() + responseHours);

    // Corps de l'email
    const body = this.generateEmailBody(draft, responseHours, deadlineDate);

    // Préparer les pièces jointes
    const attachments: SendMailOptions['attachments'] = [];

    // Ajouter le fichier Excel
    if (fs.existsSync(draft.excelPath)) {
      attachments.push({
        filename: path.basename(draft.excelPath),
        path: draft.excelPath,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    // Ajouter les pièces jointes supplémentaires (images, etc.)
    if (draft.attachmentPaths) {
      for (const attPath of draft.attachmentPaths) {
        if (fs.existsSync(attPath)) {
          attachments.push({
            filename: path.basename(attPath),
            path: attPath,
          });
        }
      }
    }

    return this.sendMail({
      to: draft.recipient,
      subject: draft.subject,
      body,
      attachments,
    });
  }

  private generateEmailBody(
    draft: any,
    responseHours: number,
    deadlineDate: Date,
  ): string {
    const clientInfo = [
      draft.clientName ? `Client: ${draft.clientName}` : '',
      draft.clientRfqNumber ? `Réf. Client: ${draft.clientRfqNumber}` : '',
      draft.clientEmail ? `Contact Client: ${draft.clientEmail}` : '',
    ].filter(x => x).join('\n');

    return `Bonjour,

Veuillez trouver ci-joint une nouvelle demande de prix à traiter.

═══════════════════════════════════════════════════════
INFORMATIONS DEMANDE
═══════════════════════════════════════════════════════
N° Demande interne: ${draft.internalRfqNumber}
Date: ${new Date().toLocaleDateString('fr-FR')}
Délai de réponse: ${responseHours}h (avant le ${deadlineDate.toLocaleDateString('fr-FR')} ${deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})

═══════════════════════════════════════════════════════
INFORMATIONS CLIENT
═══════════════════════════════════════════════════════
${clientInfo || 'Non spécifié'}

═══════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════
1. Ouvrir le fichier Excel joint
2. Compléter les colonnes "Prix Unitaire HT"
3. Retourner le fichier complété par email

---
Ce message a été envoyé automatiquement par le système de gestion des demandes de prix.
Cet email a été généré car le brouillon n'a pas été traité manuellement.`;
  }

  private textToHtml(text: string): string {
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/═/g, '─');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
    .header { background-color: #2F5496; color: white; padding: 15px; margin-bottom: 20px; }
    .content { padding: 15px; }
    .section { margin: 15px 0; padding: 10px; background-color: #f5f5f5; border-left: 4px solid #2F5496; }
    .urgent { color: #cc0000; font-weight: bold; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="content">
    <pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapedText}</pre>
  </div>
</body>
</html>`;
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('Connexion SMTP vérifiée avec succès');
      return true;
    } catch (error) {
      this.logger.error('Erreur vérification SMTP:', error.message);
      return false;
    }
  }
}
