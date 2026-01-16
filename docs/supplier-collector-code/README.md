# Supplier Collector - Code Source

Module de collecte automatique des adresses email des fournisseurs ayant répondu positivement aux demandes de prix.

## Fichiers

| Fichier | Description |
|---------|-------------|
| `mail-sync.service.ts` | **Service principal** - Synchronisation IMAP, collecte des emails positifs, scan historique |
| `offer-classifier.service.ts` | Classification des emails (OFFER, DECLINED, PENDING, NO_OFFER) basée sur scoring |
| `brand-matcher.service.ts` | Détection des marques dans les emails |
| `supplier-directory.service.ts` | Annuaire Marque → Fournisseurs |
| `supplier-collector.controller.ts` | API REST (endpoints HTTP) |
| `supplier-collector.interfaces.ts` | Types et interfaces TypeScript |
| `supplier-collector.module.ts` | Module NestJS |
| `index.ts` | Exports du module |

## Endpoints API

### Collecte des emails positifs

```bash
# Scan complet de tous les dossiers IMAP depuis janvier 2024
POST /api/supplier-collector/collect-positive-emails

# Lecture des données existantes (sans sync)
GET /api/supplier-collector/positive-emails
```

### Paramètres optionnels

- `since` - Date de début (défaut: 2024-01-01)
- `minScore` - Score minimum pour être positif (défaut: 3)

### Exemple de réponse

```json
{
  "success": true,
  "count": 13,
  "details": [
    {
      "email": "supplier@example.com",
      "name": "John Doe",
      "offerCount": 5,
      "lastSeenAt": "2024-12-15T10:30:00.000Z",
      "brands": ["CATERPILLAR", "CUMMINS"]
    }
  ]
}
```

## Conditions "Positives" (Classification = OFFER)

Un email est classifié comme OFFER si son score >= 3 :

### Points positifs
- Pièce jointe PDF/Excel : +3 pts
- Mots-clés (devis, quote, cotation, offre, prix, proforma) : +1-2 pts
- Patterns de prix (€, USD, XOF) : +2 pts
- "ci-joint", "please find attached" : +1 pt

### Points négatifs
- Mots de déclin (regret, decline, unable) : -3 à -4 pts
- Accusé réception sans offre : -2 pts

## Dépendances

- `EmailService` (src/email/) - Connexion IMAP
- `DatabaseService` (src/database/) - SQLite via sql.js
