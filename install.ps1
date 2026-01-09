# Price Request Generator - Installation Windows
# Exécuter en tant qu'administrateur si nécessaire

$Host.UI.RawUI.WindowTitle = "Price Request Generator - Installation"

Write-Host "╔═══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     PRICE REQUEST GENERATOR - Installation           ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Se déplacer vers le répertoire du script
Set-Location $PSScriptRoot

# Vérifier Node.js
Write-Host "[ETAPE] Vérification de Node.js..." -ForegroundColor Green
try {
    $nodeVersion = node -v
    Write-Host "  Node.js installé: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERREUR] Node.js n'est pas installé!" -ForegroundColor Red
    Write-Host "  Téléchargez-le sur https://nodejs.org" -ForegroundColor Yellow
    Read-Host "Appuyez sur Entrée pour quitter"
    exit 1
}

# Installer les dépendances
Write-Host ""
Write-Host "[ETAPE] Installation des dépendances npm..." -ForegroundColor Green
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERREUR] Échec de l'installation des dépendances" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Dépendances installées" -ForegroundColor Green

# Compiler le projet
Write-Host ""
Write-Host "[ETAPE] Compilation du projet TypeScript..." -ForegroundColor Green
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERREUR] Échec de la compilation" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Compilation réussie" -ForegroundColor Green

# Configuration
Write-Host ""
Write-Host "[ETAPE] Configuration de l'application..." -ForegroundColor Green

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  Fichier .env créé depuis .env.example" -ForegroundColor Yellow
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host "  CONFIGURATION REQUISE" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host ""
    
    $configure = Read-Host "Voulez-vous configurer maintenant? (o/n)"
    
    if ($configure -eq "o" -or $configure -eq "O") {
        $IMAP_HOST = Read-Host "Serveur IMAP (ex: mail.sitew.fr)"
        $IMAP_PORT = Read-Host "Port IMAP (993)"
        if ([string]::IsNullOrEmpty($IMAP_PORT)) { $IMAP_PORT = "993" }
        $IMAP_USER = Read-Host "Email"
        $IMAP_PASSWORD = Read-Host "Mot de passe" -AsSecureString
        $IMAP_PASSWORD_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($IMAP_PASSWORD))
        $DRAFTS_FOLDER = Read-Host "Dossier Brouillons (Drafts)"
        if ([string]::IsNullOrEmpty($DRAFTS_FOLDER)) { $DRAFTS_FOLDER = "Drafts" }
        
        # Mettre à jour le fichier .env
        $envContent = Get-Content ".env"
        $envContent = $envContent -replace "IMAP_HOST=.*", "IMAP_HOST=$IMAP_HOST"
        $envContent = $envContent -replace "IMAP_PORT=.*", "IMAP_PORT=$IMAP_PORT"
        $envContent = $envContent -replace "IMAP_USER=.*", "IMAP_USER=$IMAP_USER"
        $envContent = $envContent -replace "IMAP_PASSWORD=.*", "IMAP_PASSWORD=$IMAP_PASSWORD_PLAIN"
        $envContent = $envContent -replace "SMTP_HOST=.*", "SMTP_HOST=$IMAP_HOST"
        $envContent = $envContent -replace "SMTP_PORT=.*", "SMTP_PORT=465"
        $envContent = $envContent -replace "SMTP_USER=.*", "SMTP_USER=$IMAP_USER"
        $envContent = $envContent -replace "SMTP_PASSWORD=.*", "SMTP_PASSWORD=$IMAP_PASSWORD_PLAIN"
        $envContent = $envContent -replace "DRAFTS_FOLDER=.*", "DRAFTS_FOLDER=$DRAFTS_FOLDER"
        $envContent | Set-Content ".env"
        
        Write-Host "  ✓ Configuration enregistrée" -ForegroundColor Green
    } else {
        Write-Host "[ATTENTION] N'oubliez pas d'éditer le fichier .env!" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Fichier .env déjà existant" -ForegroundColor Green
}

# Créer les dossiers
New-Item -ItemType Directory -Force -Path "data" | Out-Null
New-Item -ItemType Directory -Force -Path "output" | Out-Null
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

# Choix du mode d'exécution
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MÉTHODE D'EXÉCUTION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1) Démarrage simple (terminal)"
Write-Host "  2) PM2 (processus en arrière-plan)"
Write-Host "  3) Créer un raccourci bureau"
Write-Host "  4) Installer comme service Windows (NSSM)"
Write-Host "  5) Ne pas démarrer maintenant"
Write-Host ""
$choice = Read-Host "Votre choix (1-5)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "[INFO] Démarrage de l'application..." -ForegroundColor Green
        npm run start:prod
    }
    "2" {
        Write-Host ""
        Write-Host "[INFO] Installation et configuration de PM2..." -ForegroundColor Green
        npm install -g pm2
        pm2 start ecosystem.config.js
        pm2 save
        Write-Host ""
        Write-Host "  ✓ Application démarrée avec PM2" -ForegroundColor Green
        Write-Host "  Commandes: pm2 status, pm2 logs, pm2 restart all"
    }
    "3" {
        $shortcutPath = [Environment]::GetFolderPath("Desktop") + "\Price Request Generator.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "$PSScriptRoot\start.bat"
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Description = "Price Request Generator"
        $shortcut.Save()
        Write-Host "  ✓ Raccourci créé sur le bureau" -ForegroundColor Green
    }
    "4" {
        Write-Host ""
        Write-Host "Pour installer comme service Windows, utilisez NSSM:" -ForegroundColor Yellow
        Write-Host "  1. Téléchargez NSSM: https://nssm.cc/download"
        Write-Host "  2. Exécutez: nssm install PriceRequestGenerator"
        Write-Host "  3. Path: $PSScriptRoot\start.bat"
    }
    "5" {
        Write-Host ""
        Write-Host "Installation terminée. Pour démarrer:" -ForegroundColor Yellow
        Write-Host "  .\start.bat"
        Write-Host "  ou: npm run start:prod"
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  INSTALLATION TERMINÉE" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  API disponible sur: http://localhost:3000/api" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pour configurer le traitement automatique:" -ForegroundColor White
Write-Host '  Invoke-RestMethod -Uri "http://localhost:3000/api/scheduler/configure" `' -ForegroundColor Gray
Write-Host '    -Method POST -ContentType "application/json" `' -ForegroundColor Gray
Write-Host '    -Body ''{"endDate":"2024-12-31","checkIntervalMinutes":10,"autoSendDraft":true}''' -ForegroundColor Gray
Write-Host ""
Read-Host "Appuyez sur Entrée pour fermer"
