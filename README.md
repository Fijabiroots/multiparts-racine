# Price Request Generator - Application NestJS Automatisée

Application NestJS pour automatiser la génération de demandes de prix à partir d'emails et de fichiers (PDF, Excel, Word), avec sauvegarde automatique dans les brouillons Thunderbird et gestion de la correspondance RFQ.

## 🚀 Fonctionnalités

- **Lecture automatique des emails** : Scheduler configurable pour traitement périodique
- **Filtrage intelligent** : Détection automatique des demandes de prix par mots-clés
- **Support multi-formats** : PDF, Excel (.xlsx/.xls), Word (.docx), et corps d'email
- **Base de données SQLite** : Stockage des clients et correspondances RFQ
- **Anonymisation** : Les informations clients ne sont pas visibles dans les emails sortants
- **Correspondance RFQ** : Association automatique entre numéro RFQ client et numéro interne
- **Brouillons Thunderbird** : Sauvegarde automatique via IMAP

## 📋 Prérequis

- Node.js 18+
- Thunderbird avec compte IMAP configuré
- Accès IMAP/SMTP activé sur votre serveur mail

## 🛠️ Installation

```bash
# Extraire le projet
unzip price-request-app.zip
cd price-request-app

# Installer les dépendances
npm install

# Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos paramètres

# Compiler le projet
npm run build

# Démarrer en développement
npm run start:dev

# Démarrer en production
npm run start:prod
```

## ⚙️ Configuration (.env)

```env
# Configuration IMAP (pour lire les emails)
IMAP_HOST=mail.sitew.fr
IMAP_PORT=993
IMAP_USER=rafiou.oyeossi@multipartsci.com
IMAP_PASSWORD=votre-mot-de-passe
IMAP_TLS=true

# Configuration SMTP (pour les brouillons)
SMTP_HOST=mail.sitew.fr
SMTP_PORT=465
SMTP_USER=rafiou.oyeossi@multipartsci.com
SMTP_PASSWORD=votre-mot-de-passe
SMTP_SECURE=true

# Dossier des brouillons Thunderbird
DRAFTS_FOLDER=Drafts

# Configuration de l'application
APP_PORT=3000
OUTPUT_DIR=./output
DB_PATH=./data/price-request.db
```

## 🚀 Démarrage Rapide

### 1. Configurer et démarrer le traitement automatique

```bash
# Configurer la date limite et démarrer
curl -X POST http://localhost:3000/api/scheduler/configure \
  -H "Content-Type: application/json" \
  -d '{
    "endDate": "2024-12-31T23:59:59Z",
    "folders": ["INBOX"],
    "checkIntervalMinutes": 10,
    "autoSendDraft": true,
    "startImmediately": true
  }'
```

### 2. Vérifier le statut

```bash
curl http://localhost:3000/api/scheduler/status
```

### 3. Exécuter manuellement

```bash
curl -X POST http://localhost:3000/api/scheduler/run-once
```

## 📡 API Endpoints

Base URL: `http://localhost:3000/api`

### Scheduler (Automatisation)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/scheduler/status` | État du scheduler |
| POST | `/scheduler/start` | Démarrer le traitement automatique |
| POST | `/scheduler/stop` | Arrêter le traitement automatique |
| POST | `/scheduler/run-once` | Exécuter un traitement manuel |
| POST | `/scheduler/configure` | Configurer et démarrer |
| PUT | `/scheduler/config` | Modifier la configuration |

### Base de Données

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/database/clients` | Liste des clients |
| POST | `/database/clients` | Créer un client |
| GET | `/database/rfq-mappings` | Correspondances RFQ |
| GET | `/database/rfq-mappings/by-client-rfq/:rfq` | Trouver par RFQ client |
| GET | `/database/rfq-mappings/by-internal-rfq/:rfq` | Trouver par RFQ interne |
| GET | `/database/keywords` | Mots-clés de détection |
| GET | `/database/logs` | Historique des traitements |

### Détection

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/detector/analyze` | Analyser un email (test) |
| GET | `/detector/refresh-keywords` | Recharger les mots-clés |

## 🔍 Détection des Demandes de Prix

L'application utilise des mots-clés pondérés pour identifier les demandes de prix :

**Mots-clés français** (poids élevé) :
- "demande de prix", "demande de cotation", "appel d'offres"
- "devis", "cotation", "offre de prix"

**Mots-clés anglais** :
- "RFQ", "RFP", "request for quotation"
- "price request", "quote request"

### Ajouter un mot-clé

```bash
curl -X POST http://localhost:3000/api/database/keywords \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "besoin urgent",
    "weight": 7,
    "language": "fr",
    "type": "both"
  }'
```

## 🔗 Correspondance RFQ

L'application maintient une correspondance entre :
- **RFQ Client** : Le numéro de référence du client (extrait automatiquement)
- **RFQ Interne** : Notre numéro généré (format DDP-YYYYMMDD-XXX)

### Rechercher une correspondance

```bash
# Par RFQ client
curl http://localhost:3000/api/database/rfq-mappings/by-client-rfq/CLI-RFQ-2024-001

# Par RFQ interne
curl http://localhost:3000/api/database/rfq-mappings/by-internal-rfq/DDP-20240115-042
```

## 🔒 Anonymisation

Les emails sortants sont **totalement anonymisés** :
- Aucune référence au client dans le corps de l'email
- Seul le numéro RFQ interne est visible
- Les informations clients sont stockées uniquement dans la base de données locale

## 📊 Structure de la Base de Données

```
data/
└── price-request.db  # Base SQLite
```

**Tables :**
- `clients` : Informations des clients/fournisseurs
- `rfq_mappings` : Correspondances RFQ client/interne
- `processing_config` : Configuration du scheduler
- `detection_keywords` : Mots-clés pour la détection
- `processing_logs` : Historique des traitements

## 🏗️ Architecture

```
src/
├── database/          # Gestion SQLite (clients, RFQ, config)
├── scheduler/         # Automatisation du traitement
├── detector/          # Détection des demandes de prix
├── parser/            # Extraction PDF, Excel, Word
├── email/             # Lecture IMAP
├── excel/             # Génération fichiers Excel
├── draft/             # Sauvegarde brouillons
└── price-request/     # Module principal (legacy)
```

## 📝 Exemple de Workflow

1. **Email reçu** : "Demande de cotation - Réf: CLI-2024-042"
2. **Détection** : Score 85% → Identifié comme demande de prix
3. **Extraction** : Articles extraits du PDF joint
4. **Correspondance** : CLI-2024-042 → DDP-20240115-007
5. **Excel généré** : Fichier professionnel avec formules
6. **Brouillon créé** : Email anonymisé dans Thunderbird

## 📜 License

ISC
