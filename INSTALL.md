# Guide d'Installation - Price Request Generator

## 📋 Prérequis

- **Node.js** 18+ (https://nodejs.org)
- **npm** (inclus avec Node.js)
- Compte email avec accès **IMAP/SMTP**
- **Thunderbird** configuré avec le même compte

---

## 🚀 Installation Rapide

### Windows
```batch
# Double-cliquez sur install.ps1
# OU dans PowerShell:
.\install.ps1
```

### Linux / MacOS
```bash
chmod +x install.sh
./install.sh
```

---

## 📦 Installation Manuelle

### Étape 1: Installer les dépendances
```bash
npm install
```

### Étape 2: Compiler
```bash
npm run build
```

### Étape 3: Configurer
```bash
cp .env.example .env
# Éditer .env avec vos paramètres
```

### Étape 4: Démarrer
```bash
npm run start:prod
```

---

## ⚙️ Configuration (.env)

```env
# Serveur IMAP (lecture des emails)
IMAP_HOST=mail.sitew.fr
IMAP_PORT=993
IMAP_USER=votre-email@domain.com
IMAP_PASSWORD=votre-mot-de-passe
IMAP_TLS=true

# Serveur SMTP (envoi des brouillons)
SMTP_HOST=mail.sitew.fr
SMTP_PORT=465
SMTP_USER=votre-email@domain.com
SMTP_PASSWORD=votre-mot-de-passe
SMTP_SECURE=true

# Dossier des brouillons
DRAFTS_FOLDER=Drafts

# Application
APP_PORT=3000
DB_PATH=./data/price-request.db
```

### Trouver le nom du dossier Brouillons

1. Ouvrez Thunderbird
2. Clic droit sur "Brouillons" → Propriétés
3. Notez le nom exact (généralement "Drafts" ou "INBOX.Drafts")

---

## 🔄 Méthodes d'Exécution

### 1. Terminal Simple
```bash
npm run start:prod
# ou
./start.sh        # Linux/Mac
start.bat         # Windows
```

### 2. PM2 (Recommandé pour Production)

PM2 garde l'application en arrière-plan et la redémarre automatiquement.

```bash
# Installer PM2 globalement
npm install -g pm2

# Démarrer
pm2 start ecosystem.config.js

# Sauvegarder la config (redémarrage au boot)
pm2 save
pm2 startup

# Commandes utiles
pm2 status                    # Voir le statut
pm2 logs                      # Voir les logs
pm2 restart price-request-generator  # Redémarrer
pm2 stop price-request-generator     # Arrêter
```

### 3. Service Systemd (Linux)

```bash
# Copier le fichier service
sudo cp price-request.service /etc/systemd/system/

# Éditer les chemins dans le fichier
sudo nano /etc/systemd/system/price-request.service

# Activer et démarrer
sudo systemctl daemon-reload
sudo systemctl enable price-request
sudo systemctl start price-request

# Commandes utiles
sudo systemctl status price-request
sudo journalctl -u price-request -f
```

### 4. Docker

```bash
# Construire et démarrer
docker-compose up -d --build

# Voir les logs
docker-compose logs -f

# Arrêter
docker-compose down
```

### 5. Service Windows (NSSM)

1. Téléchargez NSSM: https://nssm.cc/download
2. Exécutez:
```batch
nssm install PriceRequestGenerator
```
3. Configurez:
   - Path: `C:\chemin\vers\app\start.bat`
   - Startup directory: `C:\chemin\vers\app`

---

## 🎯 Configuration du Traitement Automatique

Une fois l'application démarrée:

```bash
# Configurer et démarrer le scheduler
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

### PowerShell (Windows)
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/scheduler/configure" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"endDate":"2024-12-31","checkIntervalMinutes":10,"autoSendDraft":true}'
```

---

## ✅ Vérification

### Tester la connexion
```bash
# Vérifier le statut
curl http://localhost:3000/api/health

# Vérifier le scheduler
curl http://localhost:3000/api/scheduler/status

# Lister les dossiers email
curl http://localhost:3000/api/emails/folders
```

### Interface Web
Ouvrez dans votre navigateur: http://localhost:3000/api

---

## 🔧 Dépannage

### Erreur de connexion IMAP
- Vérifiez les paramètres IMAP_HOST et IMAP_PORT
- Assurez-vous que IMAP est activé sur votre serveur mail
- Testez avec `telnet mail.sitew.fr 993`

### Brouillons non créés
- Vérifiez le nom du dossier DRAFTS_FOLDER
- Vérifiez les droits d'écriture IMAP

### Permission denied (Linux)
```bash
chmod +x start.sh install.sh
```

### Port déjà utilisé
```bash
# Changer le port dans .env
APP_PORT=3001
```

---

## 📁 Structure des Fichiers

```
price-request-app/
├── data/                 # Base de données SQLite
├── output/               # Fichiers Excel générés
├── logs/                 # Logs (PM2)
├── dist/                 # Code compilé
├── src/                  # Code source
├── .env                  # Configuration (à créer)
├── .env.example          # Exemple de configuration
├── start.bat             # Script démarrage Windows
├── start.sh              # Script démarrage Linux/Mac
├── install.ps1           # Installation Windows
├── install.sh            # Installation Linux/Mac
├── ecosystem.config.js   # Configuration PM2
├── docker-compose.yml    # Configuration Docker
└── Dockerfile            # Image Docker
```
