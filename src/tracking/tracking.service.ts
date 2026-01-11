import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

export interface TrackingEntry {
  timestamp: Date;
  clientRfqNumber?: string;
  internalRfqNumber: string;
  clientName?: string;
  clientEmail: string;
  subject: string;
  itemCount: number;
  status: 'traité' | 'en_attente' | 'erreur' | 'révision_manuelle';
  acknowledgmentSent: boolean;
  deadline?: string;
  notes?: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly trackingFilePath: string;
  private workbook: XLSX.WorkBook | null = null;

  constructor(private configService: ConfigService) {
    const outputDir = this.configService.get<string>('app.outputDir', './output');
    this.trackingFilePath = path.join(outputDir, 'suivi-rfq.xlsx');
    this.initializeWorkbook();
  }

  /**
   * Initialise ou charge le fichier de suivi existant
   */
  private initializeWorkbook(): void {
    try {
      // Créer le dossier si nécessaire
      const dir = path.dirname(this.trackingFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Charger le fichier existant ou en créer un nouveau
      if (fs.existsSync(this.trackingFilePath)) {
        this.workbook = XLSX.readFile(this.trackingFilePath);
        this.logger.log(`Fichier de suivi chargé: ${this.trackingFilePath}`);
      } else {
        this.workbook = XLSX.utils.book_new();
        // Créer une feuille "Index" avec les statistiques globales
        this.createIndexSheet();
        this.saveWorkbook();
        this.logger.log(`Nouveau fichier de suivi créé: ${this.trackingFilePath}`);
      }
    } catch (error) {
      this.logger.error(`Erreur initialisation fichier de suivi: ${error.message}`);
      this.workbook = XLSX.utils.book_new();
    }
  }

  /**
   * Crée la feuille Index avec les statistiques globales
   */
  private createIndexSheet(): void {
    if (!this.workbook) return;

    const indexData = [
      ['SUIVI DES DEMANDES DE PRIX - MULTIPARTS CI'],
      [''],
      ['Fichier généré automatiquement par le système de traitement des RFQ'],
      [''],
      ['Instructions:'],
      ['- Une feuille est créée pour chaque jour avec des demandes'],
      ['- Chaque ligne représente une demande de prix traitée'],
      ['- La correspondance RFQ Client ↔ RFQ Interne permet le suivi'],
      [''],
      ['Statistiques globales:'],
      ['Total RFQ traités:', 0],
      ['Dernière mise à jour:', new Date().toLocaleString('fr-FR')],
    ];

    const ws = XLSX.utils.aoa_to_sheet(indexData);
    
    // Largeur des colonnes
    ws['!cols'] = [{ wch: 60 }];
    
    // Fusionner les cellules du titre
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

    XLSX.utils.book_append_sheet(this.workbook, ws, 'Index');
  }

  /**
   * Obtient le nom de la feuille pour une date donnée
   */
  private getSheetName(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Crée ou récupère la feuille du jour
   */
  private getOrCreateDaySheet(date: Date): XLSX.WorkSheet {
    if (!this.workbook) {
      this.workbook = XLSX.utils.book_new();
    }

    const sheetName = this.getSheetName(date);
    
    // Vérifier si la feuille existe déjà
    if (this.workbook.SheetNames.includes(sheetName)) {
      return this.workbook.Sheets[sheetName];
    }

    // Créer une nouvelle feuille avec les en-têtes
    const headers = [
      'Heure',
      'N° RFQ Client',
      'N° RFQ Interne',
      'Client',
      'Email Client',
      'Sujet',
      'Nb Articles',
      'Statut',
      'Accusé Envoyé',
      'Deadline',
      'Notes'
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers]);
    
    // Style des en-têtes (largeur des colonnes)
    ws['!cols'] = [
      { wch: 10 },  // Heure
      { wch: 18 },  // N° RFQ Client
      { wch: 22 },  // N° RFQ Interne
      { wch: 25 },  // Client
      { wch: 30 },  // Email Client
      { wch: 40 },  // Sujet
      { wch: 12 },  // Nb Articles
      { wch: 18 },  // Statut
      { wch: 14 },  // Accusé Envoyé
      { wch: 20 },  // Deadline
      { wch: 35 },  // Notes
    ];

    // Ajouter la feuille au workbook
    XLSX.utils.book_append_sheet(this.workbook, ws, sheetName);
    
    // Réorganiser les feuilles (Index en premier, puis dates décroissantes)
    this.reorderSheets();

    this.logger.log(`Nouvelle feuille créée pour le ${sheetName}`);
    return ws;
  }

  /**
   * Réorganise les feuilles (Index en premier, dates décroissantes)
   */
  private reorderSheets(): void {
    if (!this.workbook) return;

    const sheetNames = this.workbook.SheetNames;
    const dateSheets = sheetNames
      .filter(name => name !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort((a, b) => b.localeCompare(a)); // Décroissant

    const otherSheets = sheetNames.filter(
      name => name !== 'Index' && !/^\d{4}-\d{2}-\d{2}$/.test(name)
    );

    // Nouvelle ordre: Index, dates décroissantes, autres
    const newOrder = ['Index', ...dateSheets, ...otherSheets].filter(
      name => sheetNames.includes(name)
    );

    // Si Index n'existe pas encore, ne pas l'inclure
    if (!sheetNames.includes('Index')) {
      newOrder.shift();
    }

    this.workbook.SheetNames = newOrder;
  }

  /**
   * Ajoute une entrée de suivi
   */
  async addEntry(entry: TrackingEntry): Promise<boolean> {
    try {
      // Recharger le fichier pour éviter les conflits
      this.reloadWorkbook();

      const ws = this.getOrCreateDaySheet(entry.timestamp);
      
      // Préparer la ligne de données
      const row = [
        entry.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        entry.clientRfqNumber || '-',
        entry.internalRfqNumber,
        entry.clientName || '-',
        entry.clientEmail,
        entry.subject.substring(0, 50) + (entry.subject.length > 50 ? '...' : ''),
        entry.itemCount,
        this.formatStatus(entry.status),
        entry.acknowledgmentSent ? 'Oui ✓' : 'Non',
        entry.deadline || '-',
        entry.notes || '',
      ];

      // Ajouter la ligne à la fin de la feuille
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: -1 });

      // Mettre à jour les statistiques dans Index
      this.updateIndexStats();

      // Sauvegarder
      this.saveWorkbook();

      this.logger.log(`Entrée ajoutée au suivi: ${entry.internalRfqNumber} (Client: ${entry.clientRfqNumber || 'N/A'})`);
      return true;

    } catch (error) {
      this.logger.error(`Erreur ajout entrée de suivi: ${error.message}`);
      return false;
    }
  }

  /**
   * Formate le statut pour l'affichage
   */
  private formatStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'traité': '✅ Traité',
      'en_attente': '⏳ En attente',
      'erreur': '❌ Erreur',
      'révision_manuelle': '👁️ Révision manuelle',
    };
    return statusMap[status] || status;
  }

  /**
   * Met à jour les statistiques dans la feuille Index
   */
  private updateIndexStats(): void {
    if (!this.workbook || !this.workbook.SheetNames.includes('Index')) return;

    try {
      // Compter le total des entrées
      let totalEntries = 0;
      for (const sheetName of this.workbook.SheetNames) {
        if (sheetName !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
          const ws = this.workbook.Sheets[sheetName];
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          totalEntries += Math.max(0, range.e.r); // Nombre de lignes - 1 (header)
        }
      }

      // Mettre à jour la feuille Index
      const indexWs = this.workbook.Sheets['Index'];
      
      // Mettre à jour les cellules de statistiques
      indexWs['B11'] = { t: 'n', v: totalEntries };
      indexWs['B12'] = { t: 's', v: new Date().toLocaleString('fr-FR') };

    } catch (error) {
      this.logger.warn(`Erreur mise à jour stats Index: ${error.message}`);
    }
  }

  /**
   * Recharge le fichier depuis le disque
   */
  private reloadWorkbook(): void {
    try {
      if (fs.existsSync(this.trackingFilePath)) {
        this.workbook = XLSX.readFile(this.trackingFilePath);
      }
    } catch (error) {
      this.logger.warn(`Erreur rechargement fichier: ${error.message}`);
    }
  }

  /**
   * Sauvegarde le fichier
   */
  private saveWorkbook(): void {
    if (!this.workbook) return;

    try {
      XLSX.writeFile(this.workbook, this.trackingFilePath);
      this.logger.debug(`Fichier de suivi sauvegardé: ${this.trackingFilePath}`);
    } catch (error) {
      this.logger.error(`Erreur sauvegarde fichier de suivi: ${error.message}`);
    }
  }

  /**
   * Obtient le chemin du fichier de suivi
   */
  getTrackingFilePath(): string {
    return this.trackingFilePath;
  }

  /**
   * Obtient les statistiques globales
   */
  getStatistics(): {
    totalEntries: number;
    todayEntries: number;
    lastUpdate: string;
    sheetCount: number;
  } {
    this.reloadWorkbook();

    let totalEntries = 0;
    let todayEntries = 0;
    const todaySheet = this.getSheetName(new Date());

    if (this.workbook) {
      for (const sheetName of this.workbook.SheetNames) {
        if (sheetName !== 'Index' && /^\d{4}-\d{2}-\d{2}$/.test(sheetName)) {
          const ws = this.workbook.Sheets[sheetName];
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          const entries = Math.max(0, range.e.r);
          totalEntries += entries;
          
          if (sheetName === todaySheet) {
            todayEntries = entries;
          }
        }
      }
    }

    return {
      totalEntries,
      todayEntries,
      lastUpdate: new Date().toLocaleString('fr-FR'),
      sheetCount: this.workbook ? 
        this.workbook.SheetNames.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).length : 0,
    };
  }

  /**
   * Vérifie si un RFQ a déjà été traité (anti-doublon)
   */
  isRfqAlreadyTracked(clientRfqNumber: string, clientEmail: string): boolean {
    this.reloadWorkbook();

    if (!this.workbook || !clientRfqNumber) return false;

    const todaySheet = this.getSheetName(new Date());

    if (!this.workbook.SheetNames.includes(todaySheet)) {
      return false;
    }

    const ws = this.workbook.Sheets[todaySheet];
    const data = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

    // Chercher une entrée avec le même RFQ client et email
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[1] === clientRfqNumber && row[4] === clientEmail) {
        return true;
      }
    }

    return false;
  }

  /**
   * Réinitialise le fichier de suivi (MODE TEST)
   * Crée un nouveau fichier vide
   */
  resetTracking(): { success: boolean; previousStats: any } {
    try {
      const previousStats = this.getStatistics();

      // Supprimer le fichier existant
      if (fs.existsSync(this.trackingFilePath)) {
        fs.unlinkSync(this.trackingFilePath);
      }

      // Créer un nouveau workbook vide
      this.workbook = XLSX.utils.book_new();
      this.createIndexSheet();
      this.saveWorkbook();

      this.logger.warn(`🔄 RESET: Fichier de suivi réinitialisé - ${previousStats.totalEntries} entrées supprimées`);

      return { success: true, previousStats };
    } catch (error) {
      this.logger.error(`Erreur réinitialisation fichier de suivi: ${error.message}`);
      return { success: false, previousStats: null };
    }
  }
}
