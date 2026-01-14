# Email Reminder / Customer Reassurance Module

## Vue d'ensemble

Ce module gère :
1. **Relances fournisseurs** - Rappels automatiques basés sur la date d'envoi réelle depuis `procurement@multipartsci.com`
2. **ACK client** - Accusé de réception automatique à la première réponse client
3. **Auto-réponse aux relances client** - Réponses rassurantes aux emails de suivi des clients

## Architecture

```
src/reminder/
├── config/
│   └── reminder.config.ts       # Configuration et keywords
├── interfaces/
│   └── reminder.interfaces.ts   # Types et interfaces
├── services/
│   ├── reminder-policy.service.ts         # Calcul dates avec règle week-end
│   ├── conversation-linker.service.ts     # Corrélation email ↔ request
│   ├── classifier-client-chaser.service.ts # Détection relances (scoring)
│   ├── customer-auto-response.service.ts  # Décision auto-réponse
│   ├── supplier-reminder.service.ts       # Gestion relances fournisseurs
│   ├── reminder-database.service.ts       # Persistance
│   ├── reminder-mail.service.ts           # Envoi emails
│   └── reminder-scheduler.service.ts      # Jobs planifiés
├── __tests__/
│   ├── reminder-policy.service.spec.ts
│   ├── classifier-client-chaser.service.spec.ts
│   └── conversation-linker.service.spec.ts
├── reminder.controller.ts
├── reminder.module.ts
└── index.ts
```

## Règles métier

### 1. Source de vérité pour l'envoi

La date de relance fournisseur est basée sur la **date réelle d'envoi** dans le dossier "Sent" de `procurement@multipartsci.com`, et NON la date de création.

Si une demande n'a pas été envoyée (aucune trace dans "Sent"), le reminder **ne s'exécute pas**.

### 2. Règle week-end

Si la date de relance calculée tombe un :
- **Samedi** → reportée au lundi (+2 jours)
- **Dimanche** → reportée au lundi (+1 jour)

### 3. Accusé de réception client

À la **première** réponse entrante d'un client liée à une demande :
- Envoi automatique d'un ACK confirmant la bonne réception
- Un seul ACK par (requestId, customerEmail)

### 4. Auto-réponse aux relances client

Si le client envoie une relance ("Any update?", "Relance", etc.) :
- Classification par score (0-100, seuil = 60)
- Vérification throttle (max 1 auto-réponse / 12h par client/demande)
- Envoi depuis `rafiou.oyeossi@multipartsci.com`

### 5. Exclusion prioritaire : NEVER_TREATED

**CRITIQUE** : Aucune auto-réponse n'est envoyée si la demande n'a jamais été traitée :
- Pas de request existante
- Status = DRAFT, NEW, ou UNLINKED
- Aucun email sortant humain

## Classifier Client Chaser

### Système de scoring (0-100)

| Catégorie | Points | Exemples |
|-----------|--------|----------|
| **Sujet fort** | +35 | "relance", "follow up", "any update" |
| **Sujet urgent** | +10 | "urgent", "asap" |
| **Corps fort** | +35 | "je me permets de relancer", "just following up" |
| **Questions courtes** | +20 | "des nouvelles ?", "any update?" |
| **Indices temporels** | +10 | "depuis X jours", "last week" |
| **Contexte thread** | +15 | Thread/InReplyTo lié |
| **Bon de commande** | -40 | "purchase order", "bon de commande" |
| **Livraison** | -30 | "tracking", "delivery", "livraison" |
| **Annulation** | -30 | "cancel", "annuler" |
| **Nouvelle demande** | -25 | "please quote", "demande de prix" |

**Décision** : Score ≥ 60 → CHASER

### Guards (blocage automatique)

1. Expéditeur `@multipartsci.com` → BLOCKED_INTERNAL
2. Headers auto-reply (`X-Multiparts-Auto`, `Auto-Submitted`) → BLOCKED_AUTO_REPLY
3. Status fermé (CLOSED, CANCELLED, etc.) → BLOCKED_CLOSED_STATUS

## Configuration

```env
# .env
REMINDER_SLA_DAYS=3
REMINDER_RUN_HOUR=9
AUTO_REPLY_THROTTLE_HOURS=12
MULTIPARTS_ACK_FROM=rafiou.oyeossi@multipartsci.com
PROCUREMENT_SENT_MAILBOX=procurement@multipartsci.com
CHASER_SCORE_THRESHOLD=60
CLOSED_STATUSES=CLOSED,CANCELLED,LOST,WON
```

## API Endpoints

### Status & Contrôle

```
GET  /api/reminder/status          # État du scheduler
POST /api/reminder/enable          # Activer
POST /api/reminder/disable         # Désactiver
```

### Déclenchement manuel

```
POST /api/reminder/trigger/supplier-reminders    # Lancer relances fournisseurs
POST /api/reminder/trigger/customer-processing   # Traiter inbox client
```

### Relances fournisseurs

```
GET  /api/reminder/supplier/pending              # Relances en attente
POST /api/reminder/supplier/schedule             # Planifier une relance
POST /api/reminder/supplier/:rfqId/responded     # Marquer comme répondu
```

### Test classifier

```
POST /api/reminder/classify        # Classifier un email complet
POST /api/reminder/analyze-text    # Tester sujet + corps
```

### Test policy

```
GET /api/reminder/policy/due-date?sentAt=2026-01-14&slaDays=3
GET /api/reminder/policy/business-days?startDate=2026-01-13&endDate=2026-01-20
```

### Logs

```
GET /api/reminder/logs/auto-emails?type=ACK_CUSTOMER_FIRST_RECEIPT&limit=50
```

## Tables DB

### customer_conversations

Suivi des conversations client par request.

| Colonne | Type | Description |
|---------|------|-------------|
| id | TEXT PK | UUID |
| request_id | TEXT | FK vers rfq_mappings |
| internal_rfq_number | TEXT | Numéro DDP |
| customer_email | TEXT | Email client |
| ack_sent_at | TEXT | Date envoi ACK |
| last_auto_reply_at | TEXT | Dernière auto-réponse |
| auto_reply_count | INTEGER | Compteur |

### auto_email_logs

Journal de tous les emails automatiques.

| Colonne | Type | Description |
|---------|------|-------------|
| id | TEXT PK | UUID |
| type | TEXT | ACK_CUSTOMER_FIRST_RECEIPT, AUTO_REPLY_CUSTOMER_CHASER, SUPPLIER_FOLLOW_UP_REMINDER |
| recipient_email | TEXT | Destinataire |
| sender_email | TEXT | Expéditeur |
| message_id | TEXT | Message-ID envoyé |
| status | TEXT | sent, failed, skipped |
| metadata | TEXT JSON | Infos supplémentaires |

### supplier_reminders

Planification des relances fournisseurs.

| Colonne | Type | Description |
|---------|------|-------------|
| id | TEXT PK | UUID |
| rfq_id | TEXT | FK vers rfq_mappings |
| supplier_email | TEXT | Email fournisseur |
| sent_at | TEXT | Date envoi original |
| due_date | TEXT | Date relance (avec rule week-end) |
| was_postponed | INTEGER | 0/1 si reporté |
| reminder_count | INTEGER | Nombre de relances envoyées |
| status | TEXT | pending, completed, responded |

## Headers anti-boucle

Tous les emails automatiques incluent :

```
X-Multiparts-Auto: 1
Auto-Submitted: auto-replied
X-Auto-Response-Suppress: All
```

## Tests

```bash
# Lancer les tests
npm test -- --testPathPattern=reminder

# Tests spécifiques
npm test -- reminder-policy.service.spec.ts
npm test -- classifier-client-chaser.service.spec.ts
npm test -- conversation-linker.service.spec.ts
```

## Flux décisionnel

```
Email entrant
    │
    ├─► Guard: interne? → BLOCKED_INTERNAL
    ├─► Guard: auto-reply header? → BLOCKED_AUTO_REPLY
    │
    ├─► Lien avec request? (ConversationLinkerService)
    │       │
    │       ├─► NOT_LINKED → Créer ticket "Nouvelle demande"
    │       │                 Pas d'auto-réponse
    │       │
    │       └─► LINKED
    │               │
    │               ├─► Request state = NEVER_TREATED?
    │               │       → SKIP (pas d'auto-réponse)
    │               │
    │               ├─► Premier email? (pas d'ACK)
    │               │       → Envoyer ACK
    │               │
    │               └─► Classifier CHASER?
    │                       │
    │                       ├─► Score < 60 → NOT_CHASER
    │                       │
    │                       └─► Score ≥ 60
    │                               │
    │                               ├─► Throttle actif? → SKIP_THROTTLED
    │                               │
    │                               └─► Envoyer auto-réponse
```

## Choix techniques

1. **Scoring vs ML** : Système de règles explicites pour transparence et configurabilité
2. **Throttle basé sur DB** : Persistant, survit aux redémarrages
3. **Headers anti-boucle** : Standards RFC pour éviter les boucles infinies
4. **Séparation Classifier / Decision Engine** : Le classifier est purement sémantique, la décision métier est séparée
5. **Weekend rule dans Policy Service** : Logique métier isolée et testable
