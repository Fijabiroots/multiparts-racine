@echo off
chcp 65001 >nul
title Price Request Generator - Installation

echo.
echo ========================================================
echo        Price Request Generator - Installation
echo ========================================================
echo.

:: Verifier Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installe.
    echo Telechargez-le depuis: https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js detecte

:: Installer les dependances
if not exist "node_modules" (
    echo [INFO] Installation des dependances...
    call npm install
) else (
    echo [OK] Dependances deja installees
)

:: Creer .env si necessaire
if not exist ".env" (
    echo [INFO] Creation du fichier .env...
    copy .env.example .env >nul
    echo.
    echo IMPORTANT: Editez le fichier .env avec vos parametres
    echo - IMAP_PASSWORD: Votre mot de passe email
    echo - SMTP_PASSWORD: Votre mot de passe email
    echo.
    notepad .env
    pause
) else (
    echo [OK] Fichier .env trouve
)

:: Creer les dossiers
if not exist "data" mkdir data
if not exist "output" mkdir output
if not exist "attachments" mkdir attachments
echo [OK] Dossiers crees

:: Compiler
echo [INFO] Compilation du projet...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Echec de la compilation
    pause
    exit /b 1
)
echo [OK] Projet compile

:: Demarrer
echo.
echo ========================================================
echo            Demarrage de l'application...
echo ========================================================
echo.
echo L'application sera accessible sur: http://localhost:3000
echo Documentation API: http://localhost:3000/api
echo.
echo Pour arreter: Ctrl+C
echo.

call npm run start:prod
