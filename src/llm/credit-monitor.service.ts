import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';

interface CreditStatus {
  isLow: boolean;
  lastChecked: Date;
  lastNotificationSent: Date | null;
  errorMessage: string | null;
}

@Injectable()
export class CreditMonitorService {
  private readonly logger = new Logger(CreditMonitorService.name);
  private status: CreditStatus = {
    isLow: false,
    lastChecked: new Date(),
    lastNotificationSent: null,
    errorMessage: null,
  };

  // Cooldown de 6 heures entre les notifications
  private readonly NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  private readonly ALERT_EMAIL = 'rafiou.oyeossi@multipartsci.com';

  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Analyse une erreur API pour détecter les problèmes de crédit
   */
  async checkApiError(error: any): Promise<void> {
    const errorMessage = this.extractErrorMessage(error);

    if (this.isCreditError(errorMessage)) {
      this.logger.warn(`⚠️ Erreur de crédit API détectée: ${errorMessage}`);
      this.status.isLow = true;
      this.status.errorMessage = errorMessage;
      this.status.lastChecked = new Date();

      await this.sendNotificationIfNeeded();
    }
  }

  /**
   * Vérifie si l'erreur est liée aux crédits API
   */
  private isCreditError(message: string): boolean {
    const creditErrorPatterns = [
      'credit balance is too low',
      'insufficient credits',
      'insufficient_quota',
      'rate_limit_error',
      'billing',
      'credits',
    ];

    const lowerMessage = message.toLowerCase();
    return creditErrorPatterns.some(pattern => lowerMessage.includes(pattern));
  }

  /**
   * Extrait le message d'erreur depuis différents formats
   */
  private extractErrorMessage(error: any): string {
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
    if (error?.error?.message) return error.error.message;
    return JSON.stringify(error);
  }

  /**
   * Envoie une notification si le cooldown est passé
   */
  private async sendNotificationIfNeeded(): Promise<void> {
    const now = new Date();

    // Vérifier le cooldown
    if (this.status.lastNotificationSent) {
      const timeSinceLastNotification = now.getTime() - this.status.lastNotificationSent.getTime();
      if (timeSinceLastNotification < this.NOTIFICATION_COOLDOWN_MS) {
        this.logger.debug('Notification déjà envoyée récemment, ignorée');
        return;
      }
    }

    try {
      const result = await this.mailService.sendMail({
        to: this.ALERT_EMAIL,
        subject: '🚨 ALERTE: Crédits API Anthropic faibles',
        body: this.buildAlertEmailBody(),
        htmlBody: this.buildAlertEmailHtml(),
      });

      if (result.success) {
        this.status.lastNotificationSent = now;
        this.logger.log(`✅ Notification de crédit envoyée à ${this.ALERT_EMAIL}`);
      } else {
        this.logger.error(`❌ Échec envoi notification: ${result.error}`);
      }
    } catch (error) {
      this.logger.error(`❌ Erreur envoi notification: ${error}`);
    }
  }

  private buildAlertEmailBody(): string {
    return `⚠️ ALERTE SYSTÈME - CRÉDITS API ANTHROPIC

Le système de traitement des demandes de prix a détecté un problème avec les crédits API Anthropic.

═══════════════════════════════════════════════════════
DÉTAILS
═══════════════════════════════════════════════════════
Date/Heure: ${new Date().toLocaleString('fr-FR')}
Message d'erreur: ${this.status.errorMessage || 'Non spécifié'}

═══════════════════════════════════════════════════════
IMPACT
═══════════════════════════════════════════════════════
- L'extraction LLM des articles est désactivée
- Le système continue avec l'extraction regex (moins précise)
- Les demandes de prix sont toujours traitées

═══════════════════════════════════════════════════════
ACTION REQUISE
═══════════════════════════════════════════════════════
1. Connectez-vous à https://console.anthropic.com
2. Vérifiez votre solde de crédits
3. Rechargez les crédits si nécessaire

---
Ce message est envoyé automatiquement par le système de monitoring.
Prochaine notification dans 6 heures si le problème persiste.`;
  }

  private buildAlertEmailHtml(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #dc3545, #c82333); color: white; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 20px; }
    .section { margin: 20px 0; padding: 15px; background: #f8f9fa; border-left: 4px solid #dc3545; }
    .section h3 { margin-top: 0; color: #dc3545; }
    .warning-box { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .action-btn { display: inline-block; background: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #ddd; }
    ul { margin: 10px 0; padding-left: 20px; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚨 Alerte Crédits API</h1>
  </div>

  <div class="content">
    <div class="warning-box">
      <strong>⚠️ Les crédits API Anthropic sont insuffisants</strong><br>
      L'extraction LLM est temporairement désactivée.
    </div>

    <div class="section">
      <h3>📋 Détails</h3>
      <ul>
        <li><strong>Date/Heure:</strong> ${new Date().toLocaleString('fr-FR')}</li>
        <li><strong>Erreur:</strong> ${this.status.errorMessage || 'Crédits insuffisants'}</li>
      </ul>
    </div>

    <div class="section">
      <h3>⚡ Impact</h3>
      <ul>
        <li>L'extraction LLM (intelligence artificielle) est désactivée</li>
        <li>Le système continue avec l'extraction regex</li>
        <li>Les demandes de prix sont toujours traitées</li>
      </ul>
    </div>

    <div class="section">
      <h3>✅ Action Requise</h3>
      <p>Rechargez vos crédits API Anthropic pour restaurer l'extraction LLM.</p>
      <a href="https://console.anthropic.com/settings/billing" class="action-btn">
        Recharger les crédits →
      </a>
    </div>
  </div>

  <div class="footer">
    Ce message est envoyé automatiquement par le système de monitoring.<br>
    Prochaine notification dans 6 heures si le problème persiste.
  </div>
</body>
</html>`;
  }

  /**
   * Réinitialise le statut quand l'API fonctionne à nouveau
   */
  resetStatus(): void {
    this.status.isLow = false;
    this.status.errorMessage = null;
    this.status.lastChecked = new Date();
  }

  /**
   * Retourne le statut actuel pour monitoring
   */
  getStatus(): CreditStatus {
    return { ...this.status };
  }
}
