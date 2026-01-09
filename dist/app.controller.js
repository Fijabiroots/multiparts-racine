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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
let AppController = class AppController {
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
    healthCheck() {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
        };
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getInfo", null);
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "healthCheck", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)()
], AppController);
//# sourceMappingURL=app.controller.js.map