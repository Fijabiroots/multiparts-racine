#!/bin/bash

# ============================================
# Script de configuration du scheduler
# ============================================

BASE_URL="http://localhost:3000/api"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║      Configuration du Scheduler Automatique            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Vérifier si l'app tourne
if ! curl -s $BASE_URL/health > /dev/null 2>&1; then
    echo "❌ L'application n'est pas en cours d'exécution."
    echo "   Démarrez-la d'abord avec: ./start.sh"
    exit 1
fi

echo "✅ Application détectée"
echo ""

# Demander la date de fin
echo "Jusqu'à quelle date voulez-vous traiter les emails?"
echo "Format: AAAA-MM-JJ (ex: 2024-12-31)"
read -p "Date de fin: " END_DATE

if [ -z "$END_DATE" ]; then
    END_DATE=$(date -d "+30 days" +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)
    echo "Date par défaut utilisée: $END_DATE"
fi

# Demander l'intervalle
echo ""
echo "Tous les combien de minutes vérifier les emails?"
read -p "Intervalle en minutes (défaut: 10): " INTERVAL
INTERVAL=${INTERVAL:-10}

# Demander pour auto-draft
echo ""
read -p "Créer automatiquement les brouillons? (O/n): " AUTO_DRAFT
if [ "$AUTO_DRAFT" = "n" ] || [ "$AUTO_DRAFT" = "N" ]; then
    AUTO_DRAFT="false"
else
    AUTO_DRAFT="true"
fi

# Demander les dossiers
echo ""
echo "Quels dossiers surveiller? (séparés par virgule)"
read -p "Dossiers (défaut: INBOX): " FOLDERS
FOLDERS=${FOLDERS:-INBOX}

# Convertir en JSON array
FOLDERS_JSON=$(echo $FOLDERS | sed 's/,/","/g')
FOLDERS_JSON="[\"$FOLDERS_JSON\"]"

echo ""
echo "Configuration:"
echo "  - Date de fin: $END_DATE"
echo "  - Intervalle: $INTERVAL minutes"
echo "  - Auto-brouillon: $AUTO_DRAFT"
echo "  - Dossiers: $FOLDERS"
echo ""

read -p "Confirmer et démarrer? (O/n): " CONFIRM
if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
    echo "Annulé."
    exit 0
fi

# Envoyer la configuration
echo ""
echo "Configuration en cours..."

RESULT=$(curl -s -X POST "$BASE_URL/scheduler/configure" \
    -H "Content-Type: application/json" \
    -d "{
        \"endDate\": \"${END_DATE}T23:59:59Z\",
        \"checkIntervalMinutes\": $INTERVAL,
        \"autoSendDraft\": $AUTO_DRAFT,
        \"folders\": $FOLDERS_JSON,
        \"startImmediately\": true
    }")

echo "Réponse: $RESULT"
echo ""

if echo "$RESULT" | grep -q "success"; then
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║     ✅ Scheduler configuré et démarré avec succès!     ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "Le système va maintenant:"
    echo "  1. Vérifier les emails toutes les $INTERVAL minutes"
    echo "  2. Détecter les demandes de prix automatiquement"
    echo "  3. Générer les fichiers Excel"
    echo "  4. Créer les brouillons dans Thunderbird"
    echo ""
    echo "Commandes utiles:"
    echo "  - Voir le statut: curl $BASE_URL/scheduler/status"
    echo "  - Exécuter maintenant: curl -X POST $BASE_URL/scheduler/run-once"
    echo "  - Arrêter: curl -X POST $BASE_URL/scheduler/stop"
else
    echo "❌ Erreur lors de la configuration"
fi
