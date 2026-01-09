#!/bin/bash

# ============================================
# Script d'installation et démarrage
# Price Request Generator v2.0
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║       Price Request Generator - Installation           ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Vérifier Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js n'est pas installé. Veuillez l'installer depuis https://nodejs.org"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ est requise. Version actuelle: $(node -v)"
        exit 1
    fi
    print_step "Node.js $(node -v) détecté"
}

# Installer les dépendances
install_deps() {
    if [ ! -d "node_modules" ]; then
        print_step "Installation des dépendances..."
        npm install
    else
        print_step "Dépendances déjà installées"
    fi
}

# Créer le fichier .env si nécessaire
setup_env() {
    if [ ! -f ".env" ]; then
        print_warning "Fichier .env non trouvé. Création depuis .env.example..."
        cp .env.example .env
        print_warning "⚠️  IMPORTANT: Éditez le fichier .env avec vos paramètres IMAP/SMTP"
        echo ""
        echo "   Paramètres à configurer:"
        echo "   - IMAP_PASSWORD: Votre mot de passe email"
        echo "   - SMTP_PASSWORD: Votre mot de passe email"
        echo ""
        read -p "Appuyez sur Entrée après avoir configuré .env..."
    else
        print_step "Fichier .env trouvé"
    fi
}

# Créer les dossiers nécessaires
create_dirs() {
    mkdir -p data output attachments
    print_step "Dossiers créés (data, output, attachments)"
}

# Compiler le projet
build_project() {
    if [ ! -d "dist" ] || [ "$(find src -newer dist -name '*.ts' 2>/dev/null | head -1)" ]; then
        print_step "Compilation du projet..."
        npm run build
    else
        print_step "Projet déjà compilé"
    fi
}

# Démarrer l'application
start_app() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║            Démarrage de l'application...               ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "L'application sera accessible sur: http://localhost:3000"
    echo "Documentation API: http://localhost:3000/api"
    echo ""
    echo "Pour arrêter: Ctrl+C"
    echo ""
    
    npm run start:prod
}

# Main
print_header
check_node
install_deps
setup_env
create_dirs
build_project
start_app
