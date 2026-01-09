#!/bin/bash

# ============================================
# Script de test - Price Request Generator
# ============================================

BASE_URL="http://localhost:3000/api"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║          Tests de l'API Price Request Generator         ║"
echo "╚════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Vérifier si l'application est en cours d'exécution
check_app() {
    echo -e "${YELLOW}[TEST]${NC} Vérification de l'application..."
    
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/health 2>/dev/null)
    
    if [ "$RESPONSE" = "200" ]; then
        echo -e "${GREEN}[OK]${NC} Application en cours d'exécution sur $BASE_URL"
        return 0
    else
        echo -e "${RED}[ERREUR]${NC} L'application n'est pas accessible sur $BASE_URL"
        echo "Démarrez l'application avec: ./start.sh"
        exit 1
    fi
}

# Test 1: Health Check
test_health() {
    echo ""
    echo -e "${YELLOW}[TEST 1]${NC} Health Check..."
    RESULT=$(curl -s $BASE_URL/health)
    echo "Réponse: $RESULT"
    echo -e "${GREEN}[OK]${NC} Health Check réussi"
}

# Test 2: Info API
test_info() {
    echo ""
    echo -e "${YELLOW}[TEST 2]${NC} Informations API..."
    curl -s $BASE_URL | head -c 500
    echo "..."
    echo -e "${GREEN}[OK]${NC} Info API réussi"
}

# Test 3: Liste des dossiers IMAP
test_folders() {
    echo ""
    echo -e "${YELLOW}[TEST 3]${NC} Liste des dossiers IMAP..."
    RESULT=$(curl -s $BASE_URL/emails/folders 2>&1)
    
    if echo "$RESULT" | grep -q "folders"; then
        echo "Réponse: $RESULT"
        echo -e "${GREEN}[OK]${NC} Connexion IMAP réussie"
    else
        echo -e "${RED}[ERREUR]${NC} Erreur connexion IMAP: $RESULT"
        echo "Vérifiez les paramètres dans .env"
    fi
}

# Test 4: Liste des emails
test_emails() {
    echo ""
    echo -e "${YELLOW}[TEST 4]${NC} Liste des emails (5 derniers)..."
    RESULT=$(curl -s "$BASE_URL/emails?limit=5" 2>&1)
    
    if echo "$RESULT" | grep -q "count"; then
        echo "$RESULT" | head -c 500
        echo "..."
        echo -e "${GREEN}[OK]${NC} Lecture emails réussie"
    else
        echo -e "${RED}[ERREUR]${NC} Erreur lecture emails: $RESULT"
    fi
}

# Test 5: Emails avec pièces jointes
test_emails_with_attachments() {
    echo ""
    echo -e "${YELLOW}[TEST 5]${NC} Emails non lus avec pièces jointes..."
    RESULT=$(curl -s "$BASE_URL/emails/unread-with-pdf" 2>&1)
    echo "$RESULT" | head -c 500
    echo ""
    echo -e "${GREEN}[OK]${NC} Test pièces jointes réussi"
}

# Test 6: Configuration du scheduler
test_scheduler_config() {
    echo ""
    echo -e "${YELLOW}[TEST 6]${NC} Configuration actuelle du scheduler..."
    RESULT=$(curl -s $BASE_URL/scheduler/status)
    echo "Réponse: $RESULT"
    echo -e "${GREEN}[OK]${NC} Lecture config réussie"
}

# Test 7: Mots-clés de détection
test_keywords() {
    echo ""
    echo -e "${YELLOW}[TEST 7]${NC} Mots-clés de détection..."
    RESULT=$(curl -s $BASE_URL/database/keywords)
    echo "$RESULT" | head -c 500
    echo "..."
    echo -e "${GREEN}[OK]${NC} Mots-clés chargés"
}

# Test 8: Test de détection
test_detection() {
    echo ""
    echo -e "${YELLOW}[TEST 8]${NC} Test de détection d'un email..."
    
    RESULT=$(curl -s -X POST $BASE_URL/detector/analyze \
        -H "Content-Type: application/json" \
        -d '{
            "subject": "Demande de prix - RFQ-2024-001",
            "body": "Bonjour, merci de nous faire parvenir votre meilleure cotation pour les articles suivants.",
            "attachments": [{"filename": "liste_articles.xlsx"}]
        }')
    
    echo "Réponse: $RESULT"
    
    if echo "$RESULT" | grep -q '"isPriceRequest":true'; then
        echo -e "${GREEN}[OK]${NC} Détection correcte: Email identifié comme demande de prix"
    else
        echo -e "${YELLOW}[INFO]${NC} Email non identifié comme demande de prix"
    fi
}

# Test 9: Liste des clients
test_clients() {
    echo ""
    echo -e "${YELLOW}[TEST 9]${NC} Liste des clients en base..."
    RESULT=$(curl -s $BASE_URL/database/clients)
    echo "Réponse: $RESULT"
    echo -e "${GREEN}[OK]${NC} Base de données accessible"
}

# Test 10: Créer un client test
test_create_client() {
    echo ""
    echo -e "${YELLOW}[TEST 10]${NC} Création d'un client test..."
    
    RESULT=$(curl -s -X POST $BASE_URL/database/clients \
        -H "Content-Type: application/json" \
        -d '{
            "code": "TEST-001",
            "name": "Client Test",
            "email": "test@example.com"
        }')
    
    echo "Réponse: $RESULT"
    
    if echo "$RESULT" | grep -q "success"; then
        echo -e "${GREEN}[OK]${NC} Client créé avec succès"
    else
        echo -e "${YELLOW}[INFO]${NC} Client déjà existant ou erreur"
    fi
}

# Test 11: Liste des brouillons
test_drafts() {
    echo ""
    echo -e "${YELLOW}[TEST 11]${NC} Liste des brouillons Thunderbird..."
    RESULT=$(curl -s "$BASE_URL/drafts?limit=3" 2>&1)
    echo "$RESULT" | head -c 500
    echo ""
    echo -e "${GREEN}[OK]${NC} Accès brouillons réussi"
}

# Test 12: Logs de traitement
test_logs() {
    echo ""
    echo -e "${YELLOW}[TEST 12]${NC} Historique des traitements..."
    RESULT=$(curl -s "$BASE_URL/database/logs?limit=5")
    echo "Réponse: $RESULT"
    echo -e "${GREEN}[OK]${NC} Logs accessibles"
}

# Résumé
summary() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    Résumé des Tests                     ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Si tous les tests sont OK, l'application est prête."
    echo ""
    echo "Prochaines étapes:"
    echo "  1. Configurer le scheduler avec une date limite:"
    echo "     curl -X POST $BASE_URL/scheduler/configure \\"
    echo "       -H 'Content-Type: application/json' \\"
    echo "       -d '{\"endDate\": \"2024-12-31\", \"autoSendDraft\": true}'"
    echo ""
    echo "  2. Ou exécuter manuellement un traitement:"
    echo "     curl -X POST $BASE_URL/scheduler/run-once"
    echo ""
}

# Exécution des tests
check_app
test_health
test_info
test_folders
test_emails
test_emails_with_attachments
test_scheduler_config
test_keywords
test_detection
test_clients
test_create_client
test_drafts
test_logs
summary
