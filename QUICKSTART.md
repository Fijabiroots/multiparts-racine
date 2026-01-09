# 🚀 Guide de Démarrage Rapide

## Étape 1 : Installation

### Windows
```
Double-cliquez sur start.bat
```

### Linux / Mac
```bash
chmod +x start.sh
./start.sh
```

### Manuellement (toutes plateformes)
```bash
npm install
npm run build
npm run start:prod
```

---

## Étape 2 : Vérification

Ouvrez votre navigateur et allez sur : **http://localhost:3000/api**

Vous devriez voir la documentation de l'API.

---

## Étape 3 : Tester la connexion email

### Linux / Mac
```bash
./test.sh
```

### Windows (PowerShell)
```powershell
# Test de connexion
Invoke-RestMethod -Uri "http://localhost:3000/api/emails/folders"

# Liste des emails
Invoke-RestMethod -Uri "http://localhost:3000/api/emails?limit=5"
```

### Avec curl (toutes plateformes)
```bash
# Test de santé
curl http://localhost:3000/api/health

# Liste des dossiers IMAP
curl http://localhost:3000/api/emails/folders

# Liste des 5 derniers emails
curl "http://localhost:3000/api/emails?limit=5"
```

---

## Étape 4 : Configurer le traitement automatique

### Option A : Script interactif (Linux/Mac)
```bash
./configure.sh
```

### Option B : Commande directe
```bash
curl -X POST http://localhost:3000/api/scheduler/configure \
  -H "Content-Type: application/json" \
  -d '{
    "endDate": "2024-12-31T23:59:59Z",
    "checkIntervalMinutes": 10,
    "autoSendDraft": true,
    "folders": ["INBOX"],
    "startImmediately": true
  }'
```

### Option C : PowerShell (Windows)
```powershell
$body = @{
    endDate = "2024-12-31T23:59:59Z"
    checkIntervalMinutes = 10
    autoSendDraft = $true
    folders = @("INBOX")
    startImmediately = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/scheduler/configure" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body
```

---

## Étape 5 : Vérifier le statut

```bash
curl http://localhost:3000/api/scheduler/status
```

Vous devriez voir :
```json
{
  "isRunning": true,
  "isProcessing": false,
  "intervalMinutes": 10,
  "config": {
    "isActive": true,
    "checkIntervalMinutes": 10,
    "folders": ["INBOX"],
    "endDate": "2024-12-31T23:59:59.000Z",
    "autoSendDraft": true
  }
}
```

---

## Commandes Utiles

| Action | Commande |
|--------|----------|
| Exécuter maintenant | `curl -X POST http://localhost:3000/api/scheduler/run-once` |
| Arrêter le scheduler | `curl -X POST http://localhost:3000/api/scheduler/stop` |
| Redémarrer | `curl -X POST http://localhost:3000/api/scheduler/start` |
| Voir les logs | `curl http://localhost:3000/api/database/logs` |
| Voir les clients | `curl http://localhost:3000/api/database/clients` |
| Voir les RFQ | `curl http://localhost:3000/api/database/rfq-mappings` |

---

## Dépannage

### L'application ne démarre pas
1. Vérifiez que Node.js 18+ est installé : `node -v`
2. Supprimez `node_modules` et relancez `npm install`
3. Vérifiez les erreurs de compilation : `npm run build`

### Erreur de connexion IMAP
1. Vérifiez les paramètres dans `.env`
2. Testez avec : `curl http://localhost:3000/api/emails/folders`
3. Vérifiez que le serveur IMAP autorise les connexions externes

### Les brouillons ne sont pas créés
1. Vérifiez le nom du dossier Brouillons : `DRAFTS_FOLDER=Drafts`
2. Dans Thunderbird : clic droit sur Brouillons > Propriétés pour voir le vrai nom

### Les emails ne sont pas détectés comme demandes de prix
1. Testez la détection manuellement :
```bash
curl -X POST http://localhost:3000/api/detector/analyze \
  -H "Content-Type: application/json" \
  -d '{"subject": "Demande de prix", "body": "Merci de nous envoyer votre cotation"}'
```
2. Ajoutez des mots-clés si nécessaire via l'API

---

## Architecture des fichiers générés

```
data/
└── price-request.db     # Base de données SQLite

output/
└── DDP-20240115-001.xlsx  # Fichiers Excel générés

logs/
├── error.log            # Erreurs (si PM2)
└── output.log           # Logs généraux (si PM2)
```

---

## Déploiement en production avec PM2

```bash
# Installer PM2
npm install -g pm2

# Démarrer l'application
pm2 start ecosystem.config.js

# Voir les logs
pm2 logs price-request-generator

# Configurer le démarrage automatique
pm2 startup
pm2 save
```
