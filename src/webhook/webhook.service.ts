import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Types d'événements webhook
 */
export enum WebhookEventType {
  // Réception de demandes
  RFQ_RECEIVED = 'rfq.received',                    // Nouvelle demande client reçue
  RFQ_PROCESSED = 'rfq.processed',                  // Demande traitée avec succès
  RFQ_PROCESSING_ERROR = 'rfq.processing_error',    // Erreur de traitement
  
  // Accusés de réception
  ACKNOWLEDGMENT_SENT = 'acknowledgment.sent',      // Accusé envoyé au client
  ACKNOWLEDGMENT_FAILED = 'acknowledgment.failed',  // Échec envoi accusé
  
  // Demandes aux fournisseurs
  RFQ_SENT_TO_SUPPLIER = 'rfq.sent_to_supplier',    // Demande envoyée à un fournisseur
  SUPPLIER_CONSULTED = 'supplier.consulted',        // Nouveau fournisseur consulté
  
  // Réponses fournisseurs
  QUOTE_RECEIVED = 'quote.received',                // Offre fournisseur reçue
  QUOTE_DECLINED = 'quote.declined',                // Fournisseur a décliné
  QUOTE_NEEDS_REVIEW = 'quote.needs_review',        // Offre nécessite révision manuelle
  
  // Comparaison
  COMPARISON_CREATED = 'comparison.created',        // Tableau comparatif créé
  COMPARISON_UPDATED = 'comparison.updated',        // Tableau comparatif mis à jour
  COMPARISON_COMPLETE = 'comparison.complete',      // Toutes les offres reçues
  
  // Relances
  REMINDER_SENT = 'reminder.sent',                  // Relance envoyée
  REMINDER_FAILED = 'reminder.failed',              // Échec envoi relance
  REMINDER_MAX_REACHED = 'reminder.max_reached',    // Max relances atteint
  
  // Suivi
  RFQ_STATUS_CHANGED = 'rfq.status_changed',        // Changement de statut RFQ
  DEADLINE_APPROACHING = 'deadline.approaching',    // Deadline proche (24h)
  DEADLINE_PASSED = 'deadline.passed',              // Deadline dépassée
  
  // Système
  SYSTEM_ERROR = 'system.error',                    // Erreur système
  DAILY_SUMMARY = 'daily.summary',                  // Résumé quotidien
}

/**
 * Structure d'un événement webhook
 */
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: Date;
  data: Record<string, any>;
  metadata?: {
    rfqNumber?: string;
    clientEmail?: string;
    supplierEmail?: string;
    filePath?: string;
  };
}

/**
 * Configuration d'un endpoint webhook
 */
export interface WebhookEndpoint {
  id: string;
  url: string;
  secret?: string;
  events: WebhookEventType[] | '*';  // '*' = tous les événements
  enabled: boolean;
  retryCount?: number;
  headers?: Record<string, string>;
}

/**
 * Résultat d'envoi webhook
 */
export interface WebhookDeliveryResult {
  endpointId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  duration?: number;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private endpoints: WebhookEndpoint[] = [];
  private httpClient: AxiosInstance;
  private readonly configFilePath: string;
  private readonly logFilePath: string;

  constructor(private configService: ConfigService) {
    this.httpClient = axios.create({
      timeout: 10000, // 10 secondes
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MultipartsCI-RFQ-Processor/1.0',
      },
    });

    const dataDir = this.configService.get<string>('app.outputDir', './output');
    this.configFilePath = path.join(dataDir, 'webhook-config.json');
    this.logFilePath = path.join(dataDir, 'webhook-log.json');
    
    this.loadEndpoints();
  }

  /**
   * Charger les endpoints depuis la configuration
   */
  private loadEndpoints(): void {
    try {
      // Charger depuis le fichier de config
      if (fs.existsSync(this.configFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.configFilePath, 'utf-8'));
        this.endpoints = data.endpoints || [];
      }

      // Ajouter l'endpoint par défaut depuis .env si configuré
      const defaultUrl = this.configService.get<string>('webhook.defaultUrl');
      if (defaultUrl && !this.endpoints.find(e => e.url === defaultUrl)) {
        this.endpoints.push({
          id: 'default',
          url: defaultUrl,
          secret: this.configService.get<string>('webhook.secret'),
          events: '*',
          enabled: true,
          retryCount: 3,
        });
      }

      this.logger.log(`${this.endpoints.filter(e => e.enabled).length} endpoint(s) webhook configuré(s)`);
    } catch (error) {
      this.logger.warn(`Erreur chargement config webhook: ${error.message}`);
    }
  }

  /**
   * Sauvegarder la configuration des endpoints
   */
  private saveEndpoints(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configFilePath, JSON.stringify({ endpoints: this.endpoints }, null, 2));
    } catch (error) {
      this.logger.error(`Erreur sauvegarde config webhook: ${error.message}`);
    }
  }

  /**
   * Ajouter un endpoint webhook
   */
  addEndpoint(endpoint: Omit<WebhookEndpoint, 'id'>): string {
    const id = `webhook_${Date.now()}`;
    this.endpoints.push({ ...endpoint, id });
    this.saveEndpoints();
    this.logger.log(`Endpoint webhook ajouté: ${id} → ${endpoint.url}`);
    return id;
  }

  /**
   * Supprimer un endpoint webhook
   */
  removeEndpoint(id: string): boolean {
    const index = this.endpoints.findIndex(e => e.id === id);
    if (index >= 0) {
      this.endpoints.splice(index, 1);
      this.saveEndpoints();
      return true;
    }
    return false;
  }

  /**
   * Activer/désactiver un endpoint
   */
  toggleEndpoint(id: string, enabled: boolean): boolean {
    const endpoint = this.endpoints.find(e => e.id === id);
    if (endpoint) {
      endpoint.enabled = enabled;
      this.saveEndpoints();
      return true;
    }
    return false;
  }

  /**
   * Lister les endpoints
   */
  listEndpoints(): WebhookEndpoint[] {
    return this.endpoints;
  }

  /**
   * Générer un ID d'événement unique
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Créer la signature HMAC pour la sécurité
   */
  private createSignature(payload: string, secret: string): string {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Envoyer un événement à tous les endpoints concernés
   */
  async emit(type: WebhookEventType, data: Record<string, any>, metadata?: WebhookEvent['metadata']): Promise<WebhookDeliveryResult[]> {
    const event: WebhookEvent = {
      id: this.generateEventId(),
      type,
      timestamp: new Date(),
      data,
      metadata,
    };

    const results: WebhookDeliveryResult[] = [];

    // Filtrer les endpoints concernés par cet événement
    const targetEndpoints = this.endpoints.filter(ep => {
      if (!ep.enabled) return false;
      if (ep.events === '*') return true;
      return ep.events.includes(type);
    });

    if (targetEndpoints.length === 0) {
      this.logger.debug(`Aucun endpoint pour l'événement ${type}`);
      return results;
    }

    // Envoyer à chaque endpoint
    for (const endpoint of targetEndpoints) {
      const result = await this.sendToEndpoint(endpoint, event);
      results.push(result);
    }

    // Logger l'événement
    this.logEvent(event, results);

    return results;
  }

  /**
   * Envoyer un événement à un endpoint spécifique
   */
  private async sendToEndpoint(endpoint: WebhookEndpoint, event: WebhookEvent): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    const payload = JSON.stringify(event);
    const maxRetries = endpoint.retryCount || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          ...endpoint.headers,
          'X-Webhook-Event': event.type,
          'X-Webhook-ID': event.id,
          'X-Webhook-Timestamp': event.timestamp.toISOString(),
        };

        // Ajouter la signature si un secret est configuré
        if (endpoint.secret) {
          headers['X-Webhook-Signature'] = this.createSignature(payload, endpoint.secret);
        }

        const response = await this.httpClient.post(endpoint.url, event, { headers });

        this.logger.log(`✅ Webhook envoyé: ${event.type} → ${endpoint.url} (${response.status})`);

        return {
          endpointId: endpoint.id,
          success: true,
          statusCode: response.status,
          duration: Date.now() - startTime,
        };

      } catch (error: any) {
        const statusCode = error.response?.status;
        const errorMessage = error.message;

        if (attempt < maxRetries) {
          this.logger.warn(`Webhook retry ${attempt}/${maxRetries}: ${endpoint.url} - ${errorMessage}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Backoff exponentiel
        } else {
          this.logger.error(`❌ Webhook échoué après ${maxRetries} tentatives: ${endpoint.url}`);
          return {
            endpointId: endpoint.id,
            success: false,
            statusCode,
            error: errorMessage,
            duration: Date.now() - startTime,
          };
        }
      }
    }

    return {
      endpointId: endpoint.id,
      success: false,
      error: 'Max retries exceeded',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Logger les événements pour historique
   */
  private logEvent(event: WebhookEvent, results: WebhookDeliveryResult[]): void {
    try {
      let logs: any[] = [];
      
      if (fs.existsSync(this.logFilePath)) {
        logs = JSON.parse(fs.readFileSync(this.logFilePath, 'utf-8'));
      }

      // Garder seulement les 1000 derniers événements
      if (logs.length >= 1000) {
        logs = logs.slice(-900);
      }

      logs.push({
        event,
        results,
        timestamp: new Date().toISOString(),
      });

      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2));
    } catch (error) {
      this.logger.debug(`Erreur log webhook: ${error.message}`);
    }
  }

  /**
   * Obtenir l'historique des événements
   */
  getEventHistory(limit = 100): any[] {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const logs = JSON.parse(fs.readFileSync(this.logFilePath, 'utf-8'));
        return logs.slice(-limit).reverse();
      }
    } catch (error) {
      this.logger.debug(`Erreur lecture log webhook: ${error.message}`);
    }
    return [];
  }

  // ============================================
  // MÉTHODES HELPER POUR ÉMETTRE LES ÉVÉNEMENTS
  // ============================================

  async emitRfqReceived(rfqNumber: string, clientEmail: string, subject: string, itemCount: number): Promise<void> {
    await this.emit(WebhookEventType.RFQ_RECEIVED, {
      rfqNumber,
      clientEmail,
      subject,
      itemCount,
      receivedAt: new Date().toISOString(),
    }, { rfqNumber, clientEmail });
  }

  async emitRfqProcessed(rfqNumber: string, clientRfqNumber: string | undefined, itemCount: number, filePath: string): Promise<void> {
    await this.emit(WebhookEventType.RFQ_PROCESSED, {
      rfqNumber,
      clientRfqNumber,
      itemCount,
      filePath,
      processedAt: new Date().toISOString(),
    }, { rfqNumber, filePath });
  }

  async emitAcknowledgmentSent(rfqNumber: string, recipients: string[]): Promise<void> {
    await this.emit(WebhookEventType.ACKNOWLEDGMENT_SENT, {
      rfqNumber,
      recipients,
      sentAt: new Date().toISOString(),
    }, { rfqNumber });
  }

  async emitQuoteReceived(rfqNumber: string, supplierEmail: string, supplierName: string | undefined, totalAmount?: number, currency?: string): Promise<void> {
    await this.emit(WebhookEventType.QUOTE_RECEIVED, {
      rfqNumber,
      supplierEmail,
      supplierName,
      totalAmount,
      currency,
      receivedAt: new Date().toISOString(),
    }, { rfqNumber, supplierEmail });
  }

  async emitQuoteDeclined(rfqNumber: string, supplierEmail: string): Promise<void> {
    await this.emit(WebhookEventType.QUOTE_DECLINED, {
      rfqNumber,
      supplierEmail,
      declinedAt: new Date().toISOString(),
    }, { rfqNumber, supplierEmail });
  }

  async emitComparisonCreated(rfqNumber: string, filePath: string, supplierCount: number): Promise<void> {
    await this.emit(WebhookEventType.COMPARISON_CREATED, {
      rfqNumber,
      filePath,
      supplierCount,
      createdAt: new Date().toISOString(),
    }, { rfqNumber, filePath });
  }

  async emitComparisonUpdated(rfqNumber: string, filePath: string, supplierCount: number, newSupplier: string): Promise<void> {
    await this.emit(WebhookEventType.COMPARISON_UPDATED, {
      rfqNumber,
      filePath,
      supplierCount,
      newSupplier,
      updatedAt: new Date().toISOString(),
    }, { rfqNumber, filePath, supplierEmail: newSupplier });
  }

  async emitComparisonComplete(rfqNumber: string, filePath: string, recommendation: string | undefined): Promise<void> {
    await this.emit(WebhookEventType.COMPARISON_COMPLETE, {
      rfqNumber,
      filePath,
      recommendation,
      completedAt: new Date().toISOString(),
    }, { rfqNumber, filePath });
  }

  async emitReminderSent(rfqNumber: string, supplierEmail: string, reminderCount: number): Promise<void> {
    await this.emit(WebhookEventType.REMINDER_SENT, {
      rfqNumber,
      supplierEmail,
      reminderCount,
      sentAt: new Date().toISOString(),
    }, { rfqNumber, supplierEmail });
  }

  async emitRfqStatusChanged(rfqNumber: string, oldStatus: string, newStatus: string): Promise<void> {
    await this.emit(WebhookEventType.RFQ_STATUS_CHANGED, {
      rfqNumber,
      oldStatus,
      newStatus,
      changedAt: new Date().toISOString(),
    }, { rfqNumber });
  }

  async emitDeadlineApproaching(rfqNumber: string, deadline: Date, hoursRemaining: number): Promise<void> {
    await this.emit(WebhookEventType.DEADLINE_APPROACHING, {
      rfqNumber,
      deadline: deadline.toISOString(),
      hoursRemaining,
    }, { rfqNumber });
  }

  async emitDailySummary(stats: Record<string, any>): Promise<void> {
    await this.emit(WebhookEventType.DAILY_SUMMARY, {
      date: new Date().toISOString().split('T')[0],
      stats,
    });
  }

  async emitSystemError(error: string, context?: Record<string, any>): Promise<void> {
    await this.emit(WebhookEventType.SYSTEM_ERROR, {
      error,
      context,
      timestamp: new Date().toISOString(),
    });
  }
}
