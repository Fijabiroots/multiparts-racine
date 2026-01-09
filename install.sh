#!/bin/bash

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════╗"
echo "║     PRICE REQUEST GENERATOR - Installation           ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$(dirname "$0")"

# Fonction pour afficher les étapes
step() {
    echo -e "\n${GREEN}[ÉTAPE]${NC} $1"
}

# Fonction pour les erreurs
error() {
    echo -e "${RED}[ERREUR]${NC} $1"
}

# Fonction pour les avertissements
warn() {
    echo -e "${YELLOW}[ATTENTION]${NC} $1"
}

# Vérifier Node.js
step "Vérification de Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "  Node.js installé: ${GREEN}$NODE_VERSION${NC}"
else
    error "Node.js n'est pas installé!"
    echo "  Installation recommandée:"
    echo "    - Ubuntu/Debian: sudo apt install nodejs npm"
    echo "    - CentOS/RHEL: sudo yum install nodejs npm"
    echo "    - MacOS: brew install node"
    echo "    - Windows: https://nodejs.org"
    exit 1
fi

# Installer les dépendances
step "Installation des dépendances npm..."
npm install
if [ $? -ne 0 ]; then
    error "Échec de l'installation des dépendances"
    exit 1
fi
echo -e "  ${GREEN}✓ Dépendances installées${NC}"

# Compiler le projet
step "Compilation du projet TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    error "Échec de la compilation"
    exit 1
fi
echo -e "  ${GREEN}✓ Compilation réussie${NC}"

# Configuration
step "Configuration de l'application..."

if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "  Fichier .env créé depuis .env.example"
    
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  CONFIGURATION REQUISE${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
    echo ""
    
    read -p "Voulez-vous configurer maintenant? (o/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        echo ""
        read -p "Serveur IMAP (ex: mail.sitew.fr): " IMAP_HOST
        read -p "Port IMAP (993): " IMAP_PORT
        IMAP_PORT=${IMAP_PORT:-993}
        read -p "Email: " IMAP_USER
        read -s -p "Mot de passe: " IMAP_PASSWORD
        echo ""
        read -p "Dossier Brouillons (Drafts): " DRAFTS_FOLDER
        DRAFTS_FOLDER=${DRAFTS_FOLDER:-Drafts}
        
        # Mettre à jour le fichier .env
        sed -i "s|IMAP_HOST=.*|IMAP_HOST=$IMAP_HOST|" .env
        sed -i "s|IMAP_PORT=.*|IMAP_PORT=$IMAP_PORT|" .env
        sed -i "s|IMAP_USER=.*|IMAP_USER=$IMAP_USER|" .env
        sed -i "s|IMAP_PASSWORD=.*|IMAP_PASSWORD=$IMAP_PASSWORD|" .env
        sed -i "s|SMTP_HOST=.*|SMTP_HOST=$IMAP_HOST|" .env
        sed -i "s|SMTP_PORT=.*|SMTP_PORT=465|" .env
        sed -i "s|SMTP_USER=.*|SMTP_USER=$IMAP_USER|" .env
        sed -i "s|SMTP_PASSWORD=.*|SMTP_PASSWORD=$IMAP_PASSWORD|" .env
        sed -i "s|DRAFTS_FOLDER=.*|DRAFTS_FOLDER=$DRAFTS_FOLDER|" .env
        
        echo -e "  ${GREEN}✓ Configuration enregistrée${NC}"
    else
        warn "N'oubliez pas d'éditer le fichier .env avant de démarrer!"
    fi
else
    echo -e "  Fichier .env déjà existant"
fi

# Créer les dossiers
mkdir -p data output logs

# Choix du mode d'exécution
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  MÉTHODE D'EXÉCUTION${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  1) Démarrage simple (terminal)"
echo "  2) PM2 (processus en arrière-plan avec redémarrage auto)"
echo "  3) Service systemd (démarrage au boot)"
echo "  4) Docker"
echo "  5) Ne pas démarrer maintenant"
echo ""
read -p "Votre choix (1-5): " CHOICE

case $CHOICE in
    1)
        step "Démarrage de l'application..."
        npm run start:prod
        ;;
    2)
        step "Installation et configuration de PM2..."
        if ! command -v pm2 &> /dev/null; then
            echo "  Installation de PM2..."
            npm install -g pm2
        fi
        pm2 start ecosystem.config.js
        pm2 save
        echo ""
        echo -e "  ${GREEN}✓ Application démarrée avec PM2${NC}"
        echo "  Commandes utiles:"
        echo "    pm2 status        - Voir le statut"
        echo "    pm2 logs          - Voir les logs"
        echo "    pm2 restart all   - Redémarrer"
        echo "    pm2 stop all      - Arrêter"
        ;;
    3)
        step "Installation du service systemd..."
        SERVICE_FILE="price-request.service"
        
        # Mettre à jour les chemins dans le fichier service
        CURRENT_DIR=$(pwd)
        USERNAME=$(whoami)
        
        sed -i "s|YOUR_USERNAME|$USERNAME|" $SERVICE_FILE
        sed -i "s|/chemin/vers/price-request-app|$CURRENT_DIR|g" $SERVICE_FILE
        
        sudo cp $SERVICE_FILE /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable price-request
        sudo systemctl start price-request
        
        echo ""
        echo -e "  ${GREEN}✓ Service installé et démarré${NC}"
        echo "  Commandes utiles:"
        echo "    sudo systemctl status price-request"
        echo "    sudo systemctl stop price-request"
        echo "    sudo systemctl restart price-request"
        echo "    sudo journalctl -u price-request -f"
        ;;
    4)
        step "Démarrage avec Docker..."
        if ! command -v docker &> /dev/null; then
            error "Docker n'est pas installé!"
            exit 1
        fi
        docker-compose up -d --build
        echo ""
        echo -e "  ${GREEN}✓ Container Docker démarré${NC}"
        echo "  Commandes utiles:"
        echo "    docker-compose logs -f"
        echo "    docker-compose stop"
        echo "    docker-compose restart"
        ;;
    5)
        echo ""
        echo "Installation terminée. Pour démarrer plus tard:"
        echo "  ./start.sh"
        echo "  ou: npm run start:prod"
        ;;
esac

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  INSTALLATION TERMINÉE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  API disponible sur: http://localhost:3000/api"
echo ""
echo "  Pour configurer le traitement automatique:"
echo '  curl -X POST http://localhost:3000/api/scheduler/configure \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"endDate":"2024-12-31","checkIntervalMinutes":10,"autoSendDraft":true}'"'"
echo ""
