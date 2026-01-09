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
var AcknowledgmentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcknowledgmentService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const fs = require("fs");
const path = require("path");
const os = require("os");
const company_info_1 = require("../common/company-info");
let AcknowledgmentService = AcknowledgmentService_1 = class AcknowledgmentService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(AcknowledgmentService_1.name);
        this.signature = '';
        this.initializeTransporter();
        this.loadThunderbirdSignature();
    }
    initializeTransporter() {
        const smtpConfig = {
            host: this.configService.get('smtp.host'),
            port: this.configService.get('smtp.port'),
            secure: this.configService.get('smtp.secure', false),
            auth: {
                user: this.configService.get('smtp.user'),
                pass: this.configService.get('smtp.password'),
            },
        };
        this.transporter = nodemailer.createTransport(smtpConfig);
        this.logger.log('SMTP transporter initialisé pour les accusés de réception');
    }
    loadThunderbirdSignature() {
        const possiblePaths = [
            path.join(os.homedir(), '.thunderbird'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'Thunderbird', 'Profiles'),
            path.join(os.homedir(), 'Library', 'Thunderbird', 'Profiles'),
            this.configService.get('email.signaturePath', ''),
        ];
        for (const basePath of possiblePaths) {
            if (!basePath || !fs.existsSync(basePath))
                continue;
            try {
                const profiles = fs.readdirSync(basePath).filter(f => f.endsWith('.default') || f.endsWith('.default-release') || f.includes('default'));
                for (const profile of profiles) {
                    const profilePath = path.join(basePath, profile);
                    const signatureFiles = [
                        'signature.html',
                        'signature.txt',
                        path.join('Mail', 'Local Folders', 'signature.html'),
                    ];
                    for (const sigFile of signatureFiles) {
                        const sigPath = path.join(profilePath, sigFile);
                        if (fs.existsSync(sigPath)) {
                            this.signature = fs.readFileSync(sigPath, 'utf-8');
                            this.logger.log(`Signature Thunderbird chargée depuis: ${sigPath}`);
                            return;
                        }
                    }
                    const prefsPath = path.join(profilePath, 'prefs.js');
                    if (fs.existsSync(prefsPath)) {
                        const prefs = fs.readFileSync(prefsPath, 'utf-8');
                        const sigMatch = prefs.match(/user_pref\("mail\.identity\.id\d+\.sig_file",\s*"([^"]+)"\)/);
                        if (sigMatch && fs.existsSync(sigMatch[1])) {
                            this.signature = fs.readFileSync(sigMatch[1], 'utf-8');
                            this.logger.log(`Signature chargée depuis prefs.js: ${sigMatch[1]}`);
                            return;
                        }
                    }
                }
            }
            catch (error) {
                this.logger.debug(`Erreur lecture profil Thunderbird ${basePath}: ${error.message}`);
            }
        }
        this.logger.warn('Signature Thunderbird non trouvée, utilisation de la signature par défaut');
        this.loadDefaultSignature();
    }
    loadDefaultSignature() {
        const defaultSigPath = this.configService.get('email.defaultSignaturePath', './signature.html');
        if (fs.existsSync(defaultSigPath)) {
            this.signature = fs.readFileSync(defaultSigPath, 'utf-8');
            this.logger.log(`Signature par défaut chargée depuis: ${defaultSigPath}`);
        }
        else {
            const c = company_info_1.COMPANY_INFO.contact;
            const addr = company_info_1.COMPANY_INFO.address;
            this.signature = `
<br><br>
--<br>
<b>${c.name}</b><br>
${c.title}<br>
<b>${company_info_1.COMPANY_INFO.name}</b><br><br>
${addr.line1}<br>
${addr.line2}<br>
${addr.city}, ${addr.country}<br><br>
Tél: ${c.phone}<br>
Mobile: ${c.mobile}<br>
Email: <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
`;
        }
    }
    setSignature(signature) {
        this.signature = signature;
        this.logger.log('Signature personnalisée définie');
    }
    loadSignatureFromFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                this.signature = fs.readFileSync(filePath, 'utf-8');
                this.logger.log(`Signature chargée depuis: ${filePath}`);
                return true;
            }
        }
        catch (error) {
            this.logger.error(`Erreur chargement signature: ${error.message}`);
        }
        return false;
    }
    async hasAcknowledgmentBeenSent(originalMessageId, originalSubject) {
        return new Promise((resolve) => {
            try {
                const imapConfig = {
                    user: this.configService.get('imap.user'),
                    password: this.configService.get('imap.password'),
                    host: this.configService.get('imap.host'),
                    port: this.configService.get('imap.port'),
                    tls: this.configService.get('imap.tls', true),
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 10000,
                };
                const imap = new Imap(imapConfig);
                const sentFolder = this.configService.get('drafts.sentFolder', 'INBOX.Sent');
                imap.once('ready', () => {
                    imap.openBox(sentFolder, true, (err, box) => {
                        if (err) {
                            this.logger.warn(`Impossible d'ouvrir le dossier Sent: ${err.message}`);
                            imap.end();
                            resolve(false);
                            return;
                        }
                        const searchCriteria = [];
                        if (originalMessageId) {
                            const twoDaysAgo = new Date();
                            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                            searchCriteria.push(['SINCE', twoDaysAgo]);
                            searchCriteria.push(['HEADER', 'IN-REPLY-TO', originalMessageId]);
                        }
                        if (searchCriteria.length === 0) {
                            const reSubject = originalSubject.startsWith('Re:')
                                ? originalSubject
                                : `Re: ${originalSubject}`;
                            const twoDaysAgo = new Date();
                            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                            searchCriteria.push(['SINCE', twoDaysAgo]);
                            searchCriteria.push(['SUBJECT', reSubject.substring(0, 50)]);
                        }
                        imap.search(searchCriteria, (searchErr, results) => {
                            imap.end();
                            if (searchErr) {
                                this.logger.warn(`Erreur recherche dans Sent: ${searchErr.message}`);
                                resolve(false);
                                return;
                            }
                            if (results && results.length > 0) {
                                this.logger.log(`✓ Accusé de réception déjà envoyé (${results.length} email(s) trouvé(s) dans Sent)`);
                                resolve(true);
                            }
                            else {
                                resolve(false);
                            }
                        });
                    });
                });
                imap.once('error', (err) => {
                    this.logger.warn(`Erreur IMAP lors de la vérification Sent: ${err.message}`);
                    resolve(false);
                });
                imap.connect();
            }
            catch (error) {
                this.logger.warn(`Exception lors de la vérification Sent: ${error.message}`);
                resolve(false);
            }
        });
    }
    async sendAcknowledgment(recipients, data) {
        try {
            if (data.originalMessageId) {
                const alreadySent = await this.hasAcknowledgmentBeenSent(data.originalMessageId, data.subject);
                if (alreadySent) {
                    this.logger.log(`⏭️ Accusé de réception déjà envoyé pour: ${data.subject}`);
                    return true;
                }
            }
            const allRecipients = new Set();
            if (recipients.from) {
                allRecipients.add(this.cleanEmailAddress(recipients.from));
            }
            if (recipients.to) {
                recipients.to.forEach(email => {
                    const cleaned = this.cleanEmailAddress(email);
                    if (!this.isOurEmail(cleaned)) {
                        allRecipients.add(cleaned);
                    }
                });
            }
            if (recipients.cc) {
                recipients.cc.forEach(email => {
                    const cleaned = this.cleanEmailAddress(email);
                    if (!this.isOurEmail(cleaned)) {
                        allRecipients.add(cleaned);
                    }
                });
            }
            if (allRecipients.size === 0) {
                this.logger.warn('Aucun destinataire valide pour l\'accusé de réception');
                return false;
            }
            const { subject, htmlBody, textBody } = this.generateAcknowledgmentContent(data);
            const mailOptions = {
                from: this.configService.get('smtp.from', 'procurement@multipartsci.com'),
                to: Array.from(allRecipients).join(', '),
                subject: subject,
                text: textBody,
                html: htmlBody,
                replyTo: this.configService.get('smtp.replyTo', 'procurement@multipartsci.com'),
            };
            if (data.originalMessageId) {
                mailOptions.inReplyTo = data.originalMessageId;
                if (data.originalReferences) {
                    mailOptions.references = `${data.originalReferences} ${data.originalMessageId}`;
                }
                else {
                    mailOptions.references = data.originalMessageId;
                }
            }
            const result = await this.transporter.sendMail(mailOptions);
            this.logger.log(`✉️ Accusé de réception envoyé à: ${mailOptions.to}`);
            this.logger.debug(`   MessageId: ${result.messageId}`);
            this.logger.debug(`   In-Reply-To: ${mailOptions.inReplyTo || 'N/A'}`);
            return true;
        }
        catch (error) {
            this.logger.error(`Erreur envoi accusé de réception: ${error.message}`);
            return false;
        }
    }
    generateAcknowledgmentContent(data) {
        const originalSubject = data.subject.replace(/^(Re:\s*)+/i, '').trim();
        const refText = data.rfqNumber ? ` [Réf: ${data.rfqNumber}]` : '';
        const subject = `Re: ${originalSubject}${refText}`;
        const greeting = data.senderName
            ? `Bonjour ${this.extractFirstName(data.senderName)},`
            : 'Bonjour,';
        const urgentNote = data.isUrgent
            ? `<p style="color: #d9534f; font-weight: bold;">⚠️ Nous avons bien noté le caractère urgent de votre demande et la traiterons en priorité.</p>`
            : '';
        const deadlineNote = data.deadline
            ? `<p>Nous avons pris note de votre délai de réponse souhaité : <strong>${data.deadline}</strong>.</p>`
            : '';
        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #2c5aa0; padding-bottom: 10px; margin-bottom: 20px; }
    .content { margin-bottom: 20px; }
    .highlight { background-color: #f5f5f5; padding: 15px; border-left: 4px solid #2c5aa0; margin: 15px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="color: #2c5aa0; margin: 0;">Accusé de Réception</h2>
    </div>
    
    <div class="content">
      <p>${greeting}</p>
      
      <p>Nous accusons bonne réception de votre demande de prix et vous en remercions.</p>
      
      <div class="highlight">
        <strong>📋 Détails de votre demande :</strong><br>
        • Objet : ${originalSubject}<br>
        ${data.rfqNumber ? `• Référence : ${data.rfqNumber}<br>` : ''}
        ${data.itemCount > 0 ? `• Nombre d'articles : ${data.itemCount}<br>` : ''}
        • Date de réception : ${new Date().toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}
      </div>
      
      ${urgentNote}
      ${deadlineNote}
      
      <p>Votre demande est actuellement en cours de traitement par notre équipe. Nous reviendrons vers vous dans les meilleurs délais avec notre offre.</p>
      
      <p>Pour toute question concernant cette demande, n'hésitez pas à nous contacter en répondant à cet email.</p>
      
      <p>Cordialement,</p>
    </div>
    
    <div class="signature">
      ${this.signature}
    </div>
  </div>
</body>
</html>`;
        const textBody = `
ACCUSÉ DE RÉCEPTION

${greeting}

Nous accusons bonne réception de votre demande de prix et vous en remercions.

DÉTAILS DE VOTRE DEMANDE :
- Objet : ${originalSubject}
${data.rfqNumber ? `- Référence : ${data.rfqNumber}` : ''}
${data.itemCount > 0 ? `- Nombre d'articles : ${data.itemCount}` : ''}
- Date de réception : ${new Date().toLocaleDateString('fr-FR')}

${data.isUrgent ? '⚠️ Nous avons bien noté le caractère urgent de votre demande et la traiterons en priorité.\n' : ''}
${data.deadline ? `Nous avons pris note de votre délai de réponse souhaité : ${data.deadline}.\n` : ''}

Votre demande est actuellement en cours de traitement par notre équipe. Nous reviendrons vers vous dans les meilleurs délais avec notre offre.

Pour toute question concernant cette demande, n'hésitez pas à nous contacter en répondant à cet email.

Cordialement,

${this.stripHtml(this.signature)}
`;
        return { subject, htmlBody, textBody };
    }
    cleanEmailAddress(email) {
        const match = email.match(/<([^>]+)>/);
        return match ? match[1].toLowerCase().trim() : email.toLowerCase().trim();
    }
    isOurEmail(email) {
        const ourEmails = [
            this.configService.get('smtp.from', ''),
            this.configService.get('smtp.user', ''),
            this.configService.get('email.address', ''),
            'procurement@multipartsci.com',
        ].map(e => e.toLowerCase());
        return ourEmails.includes(email.toLowerCase());
    }
    extractFirstName(fullName) {
        const parts = fullName.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] === parts[0].toUpperCase()) {
            return this.capitalizeFirst(parts[0]);
        }
        return this.capitalizeFirst(parts[0]);
    }
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
    stripHtml(html) {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }
};
exports.AcknowledgmentService = AcknowledgmentService;
exports.AcknowledgmentService = AcknowledgmentService = AcknowledgmentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AcknowledgmentService);
//# sourceMappingURL=acknowledgment.service.js.map