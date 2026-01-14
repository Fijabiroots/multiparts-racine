/**
 * Script de retraitement des emails du 1er au 12 janvier 2026
 *
 * ETAPE 1: Exécuter ce script pour nettoyer la base de données
 * ETAPE 2: Appeler l'API POST /api/scheduler/reprocess-january
 *
 * Le filtre exclut automatiquement les emails auto-envoyés
 * (rafiou.oyeossi@multipartsci.com comme sender ET receiver)
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'price-request.db');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const START_DATE = new Date('2026-01-01T00:00:00Z');
const END_DATE = new Date('2026-01-12T23:59:59Z');

async function main() {
  console.log('='.repeat(60));
  console.log('RETRAITEMENT JANVIER 2026 (01-12)');
  console.log('='.repeat(60));
  console.log(`\nPériode: ${START_DATE.toLocaleDateString('fr-FR')} - ${END_DATE.toLocaleDateString('fr-FR')}`);

  // Charger la base de données
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // 1. Trouver les RFQ mappings à supprimer
  const mappings = db.exec(`
    SELECT id, internal_rfq_number, email_id, excel_path, received_at, message_id
    FROM rfq_mappings
    WHERE received_at >= '${START_DATE.toISOString()}'
      AND received_at <= '${END_DATE.toISOString()}'
  `);

  if (!mappings.length || !mappings[0].values.length) {
    console.log('\nAucun RFQ trouvé dans la période.');
    db.close();
    console.log('\n' + '='.repeat(60));
    console.log('BASE DE DONNÉES PROPRE - PRÊT POUR RETRAITEMENT');
    console.log('='.repeat(60));
    showNextSteps();
    return;
  }

  const rfqToDelete = mappings[0].values;
  console.log(`\n${rfqToDelete.length} RFQ à supprimer:\n`);

  const rfqIds = [];
  const emailIds = [];
  const messageIds = [];
  const excelPaths = [];

  for (const row of rfqToDelete) {
    const [id, internalRfq, emailId, excelPath, receivedAt, messageId] = row;
    console.log(`  - ${internalRfq} (${new Date(receivedAt).toLocaleDateString('fr-FR')}) - Email ID: ${emailId}`);
    rfqIds.push(id);
    emailIds.push(emailId);
    if (messageId) messageIds.push(messageId);
    if (excelPath) excelPaths.push(excelPath);
  }

  // 2. Supprimer les fichiers Excel générés
  console.log('\n--- Suppression des fichiers Excel ---');
  let deletedFiles = 0;
  for (const excelPath of excelPaths) {
    const fullPath = path.isAbsolute(excelPath) ? excelPath : path.join(__dirname, '..', excelPath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`  Supprimé: ${path.basename(fullPath)}`);
        deletedFiles++;
      } catch (e) {
        console.log(`  Erreur: ${path.basename(fullPath)} - ${e.message}`);
      }
    }
  }
  console.log(`  ${deletedFiles} fichier(s) supprimé(s)`);

  // 3. Supprimer les pending_drafts associés
  console.log('\n--- Suppression des brouillons ---');
  if (rfqIds.length > 0) {
    const draftsResult = db.exec(`
      SELECT COUNT(*) FROM pending_drafts
      WHERE rfq_mapping_id IN (${rfqIds.map(id => `'${id}'`).join(',')})
    `);
    const draftsCount = draftsResult[0]?.values[0]?.[0] || 0;

    db.run(`
      DELETE FROM pending_drafts
      WHERE rfq_mapping_id IN (${rfqIds.map(id => `'${id}'`).join(',')})
    `);
    console.log(`  ${draftsCount} brouillon(s) supprimé(s)`);
  }

  // 4. Supprimer les output_logs associés
  console.log('\n--- Suppression des logs de sortie ---');
  if (rfqIds.length > 0) {
    const logsResult = db.exec(`
      SELECT COUNT(*) FROM output_logs
      WHERE rfq_mapping_id IN (${rfqIds.map(id => `'${id}'`).join(',')})
    `);
    const logsCount = logsResult[0]?.values[0]?.[0] || 0;

    db.run(`
      DELETE FROM output_logs
      WHERE rfq_mapping_id IN (${rfqIds.map(id => `'${id}'`).join(',')})
    `);
    console.log(`  ${logsCount} log(s) supprimé(s)`);
  }

  // 5. Supprimer les processing_logs associés
  console.log('\n--- Suppression des logs de traitement ---');
  if (emailIds.length > 0) {
    db.run(`
      DELETE FROM processing_logs
      WHERE email_id IN (${emailIds.map(id => `'${id}'`).join(',')})
    `);
    console.log('  Logs de traitement supprimés');
  }

  // 6. Supprimer les parse_logs associés (si table existe)
  try {
    if (rfqIds.length > 0) {
      db.run(`
        DELETE FROM parse_logs
        WHERE internal_rfq_number IN (${rfqIds.map((_, i) => `'${rfqToDelete[i][1]}'`).join(',')})
      `);
      console.log('  Logs de parsing supprimés');
    }
  } catch (e) {
    // Table n'existe peut-être pas
  }

  // 7. Supprimer les RFQ mappings
  console.log('\n--- Suppression des RFQ mappings ---');
  if (rfqIds.length > 0) {
    db.run(`
      DELETE FROM rfq_mappings
      WHERE id IN (${rfqIds.map(id => `'${id}'`).join(',')})
    `);
    console.log(`  ${rfqIds.length} mapping(s) supprimé(s)`);
  }

  // 8. Sauvegarder la base de données
  console.log('\n--- Sauvegarde de la base de données ---');
  const data = db.export();
  const buffer2 = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer2);
  console.log('  Base de données sauvegardée');

  db.close();

  console.log('\n' + '='.repeat(60));
  console.log('NETTOYAGE TERMINE');
  console.log('='.repeat(60));

  showNextSteps();
}

function showNextSteps() {
  console.log(`
ETAPES SUIVANTES:
=================

1. Démarrer le serveur (si pas déjà fait):
   npm run start:dev

2. Déclencher le retraitement via l'API:
   curl -X POST http://localhost:3000/api/scheduler/reprocess-january

   Ou dans un navigateur (Postman/Insomnia):
   POST http://localhost:3000/api/scheduler/reprocess-january

3. Le système va:
   - Récupérer les emails NON LUS du 1er au 12 janvier 2026
   - Exclure automatiquement les emails auto-envoyés
     (rafiou.oyeossi@multipartsci.com comme sender ET receiver)
   - Traiter les demandes de prix valides

4. Après le retraitement, supprimer le filtre temporaire:
   - Éditer src/scheduler/auto-processor.service.ts
   - Supprimer le bloc "TEMPORAIRE: Exclure les emails auto-envoyés"
   - Rebuild: npm run build

NOTE: Seuls les emails UNREAD seront traités.
Si des emails ont été marqués comme lus, il faudra les remettre en non lus
dans le client mail avant de relancer le retraitement.
`);
}

main().catch(console.error);
