import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getInfo() {
    return {
      name: 'Price Request Generator - Automated',
      version: '2.0.0',
      description: 'Application NestJS automatisée pour générer des demandes de prix',
      features: [
        'Lecture automatique des emails',
        'Filtrage intelligent des demandes de prix',
        'Support PDF, Excel, Word et corps email',
        'Base de données pour correspondance RFQ client/interne',
        'Anonymisation des informations clients',
        'Scheduler configurable',
      ],
      endpoints: {
        scheduler: {
          'GET /scheduler/status': 'État du scheduler',
          'POST /scheduler/start': 'Démarrer le traitement automatique',
          'POST /scheduler/stop': 'Arrêter le traitement automatique',
          'POST /scheduler/run-once': 'Exécuter un traitement manuel',
          'POST /scheduler/configure': 'Configurer et démarrer (endDate, folders, interval)',
          'PUT /scheduler/config': 'Modifier la configuration',
        },
        database: {
          'GET /database/clients': 'Liste des clients',
          'POST /database/clients': 'Créer un client',
          'GET /database/rfq-mappings': 'Liste des correspondances RFQ',
          'GET /database/rfq-mappings/by-client-rfq/:rfq': 'Trouver par RFQ client',
          'GET /database/rfq-mappings/by-internal-rfq/:rfq': 'Trouver par RFQ interne',
          'GET /database/config': 'Configuration actuelle',
          'GET /database/keywords': 'Mots-clés de détection',
          'GET /database/logs': 'Historique des traitements',
        },
        detector: {
          'POST /detector/analyze': 'Analyser un email (test)',
          'GET /detector/refresh-keywords': 'Recharger les mots-clés',
        },
        emails: {
          'GET /emails': 'Liste les emails',
          'GET /emails/folders': 'Liste les dossiers IMAP',
          'GET /emails/unread-with-pdf': 'Emails non lus avec pièces jointes',
          'GET /emails/:id': "Détails d'un email",
        },
        excel: {
          'POST /excel/generate': 'Générer un fichier Excel manuellement',
          'POST /excel/preview': 'Prévisualiser une demande',
        },
        drafts: {
          'GET /drafts': 'Liste les brouillons',
          'POST /drafts/save': 'Sauvegarder un brouillon',
        },
      },
      quickStart: {
        step1: 'Configurer .env avec vos paramètres IMAP/SMTP',
        step2: 'POST /api/scheduler/configure avec endDate pour définir la limite',
        step3: 'Le système traite automatiquement les emails de demande de prix',
        step4: 'Les brouillons sont créés dans Thunderbird avec le fichier Excel',
      },
    };
  }

  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
