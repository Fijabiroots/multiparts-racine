import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { WebhookService, WebhookEventType, WebhookEndpoint } from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  /**
   * GET /webhooks/endpoints
   * Liste tous les endpoints configurés
   */
  @Get('endpoints')
  listEndpoints() {
    const endpoints = this.webhookService.listEndpoints();
    return {
      success: true,
      count: endpoints.length,
      data: endpoints.map(ep => ({
        ...ep,
        secret: ep.secret ? '***' : undefined, // Masquer le secret
      })),
    };
  }

  /**
   * POST /webhooks/endpoints
   * Ajouter un nouvel endpoint
   */
  @Post('endpoints')
  addEndpoint(@Body() body: {
    url: string;
    secret?: string;
    events?: WebhookEventType[] | '*';
    enabled?: boolean;
    headers?: Record<string, string>;
  }) {
    if (!body.url) {
      return { success: false, error: 'URL requise' };
    }

    const id = this.webhookService.addEndpoint({
      url: body.url,
      secret: body.secret,
      events: body.events || '*',
      enabled: body.enabled !== false,
      headers: body.headers,
      retryCount: 3,
    });

    return {
      success: true,
      message: 'Endpoint ajouté',
      data: { id, url: body.url },
    };
  }

  /**
   * DELETE /webhooks/endpoints/:id
   * Supprimer un endpoint
   */
  @Delete('endpoints/:id')
  removeEndpoint(@Param('id') id: string) {
    const success = this.webhookService.removeEndpoint(id);
    return {
      success,
      message: success ? 'Endpoint supprimé' : 'Endpoint non trouvé',
    };
  }

  /**
   * POST /webhooks/endpoints/:id/toggle
   * Activer/désactiver un endpoint
   */
  @Post('endpoints/:id/toggle')
  toggleEndpoint(
    @Param('id') id: string,
    @Body() body: { enabled: boolean }
  ) {
    const success = this.webhookService.toggleEndpoint(id, body.enabled);
    return {
      success,
      message: success ? `Endpoint ${body.enabled ? 'activé' : 'désactivé'}` : 'Endpoint non trouvé',
    };
  }

  /**
   * GET /webhooks/events
   * Liste tous les types d'événements disponibles
   */
  @Get('events')
  listEventTypes() {
    return {
      success: true,
      data: Object.values(WebhookEventType).map(type => ({
        type,
        category: type.split('.')[0],
        description: this.getEventDescription(type),
      })),
    };
  }

  /**
   * GET /webhooks/history
   * Historique des événements envoyés
   */
  @Get('history')
  getHistory(@Query('limit') limit?: string) {
    const history = this.webhookService.getEventHistory(
      limit ? parseInt(limit, 10) : 100
    );
    return {
      success: true,
      count: history.length,
      data: history,
    };
  }

  /**
   * POST /webhooks/test
   * Envoyer un événement de test
   */
  @Post('test')
  async testWebhook(@Body() body: { url?: string }) {
    const results = await this.webhookService.emit(
      WebhookEventType.RFQ_RECEIVED,
      {
        rfqNumber: 'TEST-001',
        clientEmail: 'test@example.com',
        subject: 'Test Webhook - Demande de prix',
        itemCount: 5,
        receivedAt: new Date().toISOString(),
        isTest: true,
      },
      { rfqNumber: 'TEST-001' }
    );

    return {
      success: true,
      message: 'Événement de test envoyé',
      results: results.map(r => ({
        endpointId: r.endpointId,
        success: r.success,
        statusCode: r.statusCode,
        duration: r.duration,
        error: r.error,
      })),
    };
  }

  /**
   * Description des événements
   */
  private getEventDescription(type: WebhookEventType): string {
    const descriptions: Record<WebhookEventType, string> = {
      [WebhookEventType.RFQ_RECEIVED]: 'Nouvelle demande client reçue',
      [WebhookEventType.RFQ_PROCESSED]: 'Demande traitée avec succès',
      [WebhookEventType.RFQ_PROCESSING_ERROR]: 'Erreur lors du traitement',
      [WebhookEventType.ACKNOWLEDGMENT_SENT]: 'Accusé de réception envoyé au client',
      [WebhookEventType.ACKNOWLEDGMENT_FAILED]: 'Échec envoi accusé de réception',
      [WebhookEventType.RFQ_SENT_TO_SUPPLIER]: 'Demande envoyée à un fournisseur',
      [WebhookEventType.SUPPLIER_CONSULTED]: 'Nouveau fournisseur consulté',
      [WebhookEventType.QUOTE_RECEIVED]: 'Offre fournisseur reçue',
      [WebhookEventType.QUOTE_DECLINED]: 'Fournisseur a décliné la demande',
      [WebhookEventType.QUOTE_NEEDS_REVIEW]: 'Offre nécessite révision manuelle',
      [WebhookEventType.COMPARISON_CREATED]: 'Tableau comparatif créé',
      [WebhookEventType.COMPARISON_UPDATED]: 'Tableau comparatif mis à jour',
      [WebhookEventType.COMPARISON_COMPLETE]: 'Toutes les offres reçues',
      [WebhookEventType.REMINDER_SENT]: 'Relance envoyée au fournisseur',
      [WebhookEventType.REMINDER_FAILED]: 'Échec envoi relance',
      [WebhookEventType.REMINDER_MAX_REACHED]: 'Nombre maximum de relances atteint',
      [WebhookEventType.RFQ_STATUS_CHANGED]: 'Changement de statut de la demande',
      [WebhookEventType.DEADLINE_APPROACHING]: 'Deadline proche (moins de 24h)',
      [WebhookEventType.DEADLINE_PASSED]: 'Deadline dépassée',
      [WebhookEventType.SYSTEM_ERROR]: 'Erreur système',
      [WebhookEventType.DAILY_SUMMARY]: 'Résumé quotidien',
    };
    return descriptions[type] || type;
  }
}
