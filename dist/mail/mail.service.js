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
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer = require("nodemailer");
const imapSimple = require("imap-simple");
const fs = require("fs");
const path = require("path");
let MailService = MailService_1 = class MailService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(MailService_1.name);
        this.initTransporter();
    }
    initTransporter() {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get('smtp.host'),
            port: this.configService.get('smtp.port'),
            secure: this.configService.get('smtp.secure'),
            auth: {
                user: this.configService.get('smtp.user'),
                pass: this.configService.get('smtp.password'),
            },
            tls: {
                rejectUnauthorized: false,
            },
        });
        this.logger.log('Transporteur SMTP initialisé');
    }
    getImapConfig() {
        return {
            imap: {
                host: this.configService.get('imap.host'),
                port: this.configService.get('imap.port'),
                user: this.configService.get('imap.user'),
                password: this.configService.get('imap.password'),
                tls: this.configService.get('imap.tls'),
                authTimeout: this.configService.get('imap.authTimeout'),
                tlsOptions: this.configService.get('imap.tlsOptions'),
            },
        };
    }
    async sendMail(options) {
        try {
            const fromEmail = this.configService.get('smtp.user');
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
            const mailOptions = {
                from: fromEmail,
                to: options.to,
                subject: options.subject,
                text: options.body,
                html: options.htmlBody || this.textToHtml(options.body),
                attachments,
            };
            const info = await this.transporter.sendMail(mailOptions);
            this.logger.log(`Email envoyé à ${options.to}: ${info.messageId}`);
            try {
                await this.copyToSentFolder(mailOptions);
                this.logger.log(`Email copié dans le dossier Sent`);
            }
            catch (imapError) {
                this.logger.warn(`Impossible de copier dans Sent: ${imapError.message}`);
            }
            return {
                success: true,
                messageId: info.messageId,
            };
        }
        catch (error) {
            this.logger.error(`Erreur envoi email à ${options.to}:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }
    async copyToSentFolder(mailOptions) {
        let connection = null;
        try {
            connection = await imapSimple.connect(this.getImapConfig());
            const configuredSentFolder = this.configService.get('drafts.sentFolder');
            const sentFolderNames = configuredSentFolder
                ? [configuredSentFolder]
                : [
                    'INBOX.Sent',
                    'INBOX/Sent',
                    'Sent',
                    'INBOX.Envoyés',
                    'INBOX/Envoyés',
                    'Envoyés',
                    'Sent Items',
                    'INBOX.Sent Items',
                    'INBOX/Sent Items',
                    'Sent Messages',
                    'INBOX.Sent Messages',
                ];
            let sentFolder = null;
            for (const name of sentFolderNames) {
                try {
                    await connection.openBox(name);
                    sentFolder = name;
                    this.logger.debug(`Dossier Sent trouvé: ${name}`);
                    break;
                }
                catch (err) {
                    this.logger.debug(`Dossier ${name} non trouvé, essai suivant...`);
                }
            }
            if (!sentFolder) {
                this.logger.warn(`Aucun dossier Sent trouvé parmi: ${sentFolderNames.join(', ')}`);
                return;
            }
            const mimeMessage = await this.createMimeMessageFromOptions(mailOptions);
            await new Promise((resolve, reject) => {
                connection.imap.append(mimeMessage, {
                    mailbox: sentFolder,
                    flags: ['\\Seen'],
                }, (err) => {
                    if (err) {
                        this.logger.error(`Erreur append dans ${sentFolder}: ${err.message}`);
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            });
            this.logger.log(`Email copié dans ${sentFolder}`);
        }
        catch (error) {
            this.logger.error(`Erreur copie vers Sent: ${error.message}`);
            throw error;
        }
        finally {
            if (connection) {
                try {
                    connection.end();
                }
                catch (e) {
                }
            }
        }
    }
    async createMimeMessageFromOptions(mailOptions) {
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
                const chunks = [];
                const stream = info.message;
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => {
                    const message = Buffer.concat(chunks).toString();
                    const dateHeader = `Date: ${new Date().toUTCString()}\r\n`;
                    const finalMessage = dateHeader + message;
                    resolve(finalMessage);
                });
                stream.on('error', reject);
            });
        });
    }
    async sendPriceRequestEmail(draft) {
        const responseHours = draft.responseDeadlineHours || 24;
        const deadlineDate = new Date();
        deadlineDate.setHours(deadlineDate.getHours() + responseHours);
        const body = this.generateEmailBody(draft, responseHours, deadlineDate);
        const attachments = [];
        if (fs.existsSync(draft.excelPath)) {
            attachments.push({
                filename: path.basename(draft.excelPath),
                path: draft.excelPath,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
        }
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
    generateEmailBody(draft, responseHours, deadlineDate) {
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
    textToHtml(text) {
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
    async verifyConnection() {
        try {
            await this.transporter.verify();
            this.logger.log('Connexion SMTP vérifiée avec succès');
            return true;
        }
        catch (error) {
            this.logger.error('Erreur vérification SMTP:', error.message);
            return false;
        }
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map