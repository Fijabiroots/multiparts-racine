import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as Imap from 'imap';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { COMPANY_INFO } from '../common/company-info';

export interface EmailRecipients {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
}

export interface AcknowledgmentData {
  rfqNumber?: string;
  subject: string;
  itemCount: number;
  deadline?: string;
  senderName?: string;
  isUrgent?: boolean;
  // Pour le threading (réponse liée)
  originalMessageId?: string;
  originalReferences?: string;
}

@Injectable()
export class AcknowledgmentService {
  private readonly logger = new Logger(AcknowledgmentService.name);
  private transporter: nodemailer.Transporter;
  private signature: string = '';

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
    this.loadThunderbirdSignature();
  }

  private initializeTransporter(): void {
    const smtpConfig = {
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure: this.configService.get<boolean>('smtp.secure', false),
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.password'),
      },
    };

    this.transporter = nodemailer.createTransport(smtpConfig);
    this.logger.log('SMTP transporter initialisé pour les accusés de réception');
  }

  /**
   * Charge la signature depuis Thunderbird
   * Cherche dans les emplacements standard de Thunderbird
   */
  private loadThunderbirdSignature(): void {
    const possiblePaths = [
      // Linux
      path.join(os.homedir(), '.thunderbird'),
      // Windows
      path.join(os.homedir(), 'AppData', 'Roaming', 'Thunderbird', 'Profiles'),
      // macOS
      path.join(os.homedir(), 'Library', 'Thunderbird', 'Profiles'),
      // Chemin personnalisé depuis config
      this.configService.get<string>('email.signaturePath', ''),
    ];

    for (const basePath of possiblePaths) {
      if (!basePath || !fs.existsSync(basePath)) continue;

      try {
        // Chercher le dossier de profil
        const profiles = fs.readdirSync(basePath).filter(f => 
          f.endsWith('.default') || f.endsWith('.default-release') || f.includes('default')
        );

        for (const profile of profiles) {
          const profilePath = path.join(basePath, profile);
          
          // Chercher les fichiers de signature
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

          // Chercher dans prefs.js pour le chemin de signature
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
      } catch (error) {
        this.logger.debug(`Erreur lecture profil Thunderbird ${basePath}: ${error.message}`);
      }
    }

    // Signature par défaut si non trouvée
    this.logger.warn('Signature Thunderbird non trouvée, utilisation de la signature par défaut');
    this.loadDefaultSignature();
  }

  /**
   * Charge une signature par défaut depuis la config ou un fichier local
   */
  private loadDefaultSignature(): void {
    const defaultSigPath = this.configService.get<string>('email.defaultSignaturePath', './signature.html');
    
    if (fs.existsSync(defaultSigPath)) {
      this.signature = fs.readFileSync(defaultSigPath, 'utf-8');
      this.logger.log(`Signature par défaut chargée depuis: ${defaultSigPath}`);
    } else {
      // Signature avec infos entreprise
      const c = COMPANY_INFO.contact;
      const addr = COMPANY_INFO.address;
      this.signature = `
<br><br>
--<br>
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
   * Définir une signature personnalisée
   */
  setSignature(signature: string): void {
    this.signature = signature;
    this.logger.log('Signature personnalisée définie');
  }

  /**
   * Charger la signature depuis un fichier spécifique
   */
  loadSignatureFromFile(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        this.signature = fs.readFileSync(filePath, 'utf-8');
        this.logger.log(`Signature chargée depuis: ${filePath}`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Erreur chargement signature: ${error.message}`);
    }
    return false;
  }

  /**
   * Vérifie si un accusé de réception a déjà été envoyé pour cet email
   * en cherchant dans le dossier Sent
   */
  async hasAcknowledgmentBeenSent(originalMessageId: string, originalSubject: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const imapConfig = {
          user: this.configService.get<string>('imap.user'),
          password: this.configService.get<string>('imap.password'),
          host: this.configService.get<string>('imap.host'),
          port: this.configService.get<number>('imap.port'),
          tls: this.configService.get<boolean>('imap.tls', true),
          tlsOptions: { rejectUnauthorized: false },
          authTimeout: 10000,
        };

        const imap = new Imap(imapConfig);
        const sentFolder = this.configService.get<string>('drafts.sentFolder', 'INBOX.Sent');

        imap.once('ready', () => {
          imap.openBox(sentFolder, true, (err, box) => {
            if (err) {
              this.logger.warn(`Impossible d'ouvrir le dossier Sent: ${err.message}`);
              imap.end();
              resolve(false);
              return;
            }

            // Chercher les emails avec le sujet "Re: [sujet original]" ou In-Reply-To
            const searchCriteria: any[] = [];
            
            // Méthode 1: Chercher par In-Reply-To header (plus fiable)
            if (originalMessageId) {
              // Chercher les emails envoyés récemment (dernières 48h) qui répondent à cet email
              const twoDaysAgo = new Date();
              twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
              searchCriteria.push(['SINCE', twoDaysAgo]);
              searchCriteria.push(['HEADER', 'IN-REPLY-TO', originalMessageId]);
            }

            // Méthode 2: Chercher par sujet si pas de Message-ID
            if (searchCriteria.length === 0) {
              const reSubject = originalSubject.startsWith('Re:') 
                ? originalSubject 
                : `Re: ${originalSubject}`;
              const twoDaysAgo = new Date();
              twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
              searchCriteria.push(['SINCE', twoDaysAgo]);
              searchCriteria.push(['SUBJECT', reSubject.substring(0, 50)]); // Limiter la longueur
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
              } else {
                resolve(false);
              }
            });
          });
        });

        imap.once('error', (err: Error) => {
          this.logger.warn(`Erreur IMAP lors de la vérification Sent: ${err.message}`);
          resolve(false); // En cas d'erreur, on permet l'envoi
        });

        imap.connect();

      } catch (error) {
        this.logger.warn(`Exception lors de la vérification Sent: ${error.message}`);
        resolve(false); // En cas d'erreur, on permet l'envoi
      }
    });
  }

  /**
   * Envoyer un accusé de réception (comme RÉPONSE à l'email original)
   */
  async sendAcknowledgment(
    recipients: EmailRecipients,
    data: AcknowledgmentData,
  ): Promise<boolean> {
    try {
      // ========================================
      // 1. VÉRIFIER SI DÉJÀ ENVOYÉ
      // ========================================
      if (data.originalMessageId) {
        const alreadySent = await this.hasAcknowledgmentBeenSent(
          data.originalMessageId, 
          data.subject
        );
        
        if (alreadySent) {
          this.logger.log(`⏭️ Accusé de réception déjà envoyé pour: ${data.subject}`);
          return true; // Retourner true car c'est déjà fait
        }
      }

      // ========================================
      // 2. CONSTRUIRE LA LISTE DES DESTINATAIRES
      // ========================================
      const allRecipients = new Set<string>();
      
      // Ajouter l'expéditeur original
      if (recipients.from) {
        allRecipients.add(this.cleanEmailAddress(recipients.from));
      }
      
      // Ajouter les destinataires To (au cas où c'est une demande en copie)
      if (recipients.to) {
        recipients.to.forEach(email => {
          const cleaned = this.cleanEmailAddress(email);
          // Ne pas s'envoyer à soi-même
          if (!this.isOurEmail(cleaned)) {
            allRecipients.add(cleaned);
          }
        });
      }
      
      // Ajouter les CC
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

      // ========================================
      // 3. GÉNÉRER LE CONTENU
      // ========================================
      const { subject, htmlBody, textBody } = this.generateAcknowledgmentContent(data);

      // ========================================
      // 4. PRÉPARER L'EMAIL COMME UNE RÉPONSE
      // ========================================
      const mailOptions: nodemailer.SendMailOptions = {
        from: this.configService.get<string>('smtp.from', 'procurement@multipartsci.com'),
        to: Array.from(allRecipients).join(', '),
        subject: subject,
        text: textBody,
        html: htmlBody,
        replyTo: this.configService.get<string>('smtp.replyTo', 'procurement@multipartsci.com'),
      };

      // ========================================
      // 5. AJOUTER LES HEADERS POUR LE THREADING
      // ========================================
      // Ces headers font que l'email apparaît comme une RÉPONSE liée
      if (data.originalMessageId) {
        mailOptions.inReplyTo = data.originalMessageId;
        
        // References inclut le Message-ID original + les références précédentes
        if (data.originalReferences) {
          mailOptions.references = `${data.originalReferences} ${data.originalMessageId}`;
        } else {
          mailOptions.references = data.originalMessageId;
        }
      }

      // ========================================
      // 6. ENVOYER L'EMAIL
      // ========================================
      const result = await this.transporter.sendMail(mailOptions);
      
      this.logger.log(`✉️ Accusé de réception envoyé à: ${mailOptions.to}`);
      this.logger.debug(`   MessageId: ${result.messageId}`);
      this.logger.debug(`   In-Reply-To: ${mailOptions.inReplyTo || 'N/A'}`);
      
      return true;

    } catch (error) {
      this.logger.error(`Erreur envoi accusé de réception: ${error.message}`);
      return false;
    }
  }

  /**
   * Génère le contenu de l'accusé de réception
   */
  private generateAcknowledgmentContent(data: AcknowledgmentData): {
    subject: string;
    htmlBody: string;
    textBody: string;
  } {
    // Sujet avec "Re:" pour indiquer une réponse
    const originalSubject = data.subject.replace(/^(Re:\s*)+/i, '').trim();
    const refText = data.rfqNumber ? ` [Réf: ${data.rfqNumber}]` : '';
    const subject = `Re: ${originalSubject}${refText}`;

    // Salutation personnalisée
    const greeting = data.senderName 
      ? `Bonjour ${this.extractFirstName(data.senderName)},`
      : 'Bonjour,';

    // Mention urgence si applicable
    const urgentNote = data.isUrgent 
      ? `<p style="color: #d9534f; font-weight: bold;">⚠️ Nous avons bien noté le caractère urgent de votre demande et la traiterons en priorité.</p>`
      : '';

    // Mention deadline si applicable
    const deadlineNote = data.deadline
      ? `<p>Nous avons pris note de votre délai de réponse souhaité : <strong>${data.deadline}</strong>.</p>`
      : '';

    // Corps HTML
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

    // Corps texte (fallback)
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

  /**
   * Nettoie une adresse email (enlève le nom si présent)
   */
  private cleanEmailAddress(email: string): string {
    const match = email.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase().trim() : email.toLowerCase().trim();
  }

  /**
   * Vérifie si c'est notre propre adresse email
   */
  private isOurEmail(email: string): boolean {
    const ourEmails = [
      this.configService.get<string>('smtp.from', ''),
      this.configService.get<string>('smtp.user', ''),
      this.configService.get<string>('email.address', ''),
      'procurement@multipartsci.com',
    ].map(e => e.toLowerCase());
    
    return ourEmails.includes(email.toLowerCase());
  }

  /**
   * Extrait le prénom d'un nom complet
   */
  private extractFirstName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    // Si le nom est en MAJUSCULES (ex: "YAO BAUDELAIRE"), prendre le premier
    if (parts.length >= 2 && parts[0] === parts[0].toUpperCase()) {
      return this.capitalizeFirst(parts[0]);
    }
    return this.capitalizeFirst(parts[0]);
  }

  /**
   * Met en majuscule la première lettre
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Supprime les balises HTML
   */
  private stripHtml(html: string): string {
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
}
