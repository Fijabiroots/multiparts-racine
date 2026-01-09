import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { ExcelService } from '../excel/excel.service';
import { 
  DraftRecord, 
  DraftStatus, 
  PriceRequestItem, 
  DraftUpdateRequest,
  DraftReviewResponse 
} from '../common/interfaces';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);
  private readonly pdfStoragePath: string;

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
    private excelService: ExcelService,
  ) {
    // Répertoire de stockage des PDFs originaux
    this.pdfStoragePath = this.configService.get<string>('PDF_STORAGE_PATH') || './storage/pdfs';
    this.ensureStorageDirectory();
  }

  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.pdfStoragePath)) {
      fs.mkdirSync(this.pdfStoragePath, { recursive: true });
      this.logger.log(`Répertoire de stockage PDF créé: ${this.pdfStoragePath}`);
    }
  }

  /**
   * Stocker le PDF original et retourner le chemin
   */
  async storeOriginalPdf(buffer: Buffer, filename: string, draftId: string): Promise<string> {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFilename = `${draftId}_${safeFilename}`;
    const filePath = path.join(this.pdfStoragePath, storedFilename);
    
    try {
      fs.writeFileSync(filePath, buffer);
      this.logger.log(`PDF original stocké: ${filePath}`);
      return filePath;
    } catch (error) {
      this.logger.error(`Erreur stockage PDF: ${error.message}`);
      throw error;
    }
  }

  /**
   * Récupérer tous les drafts en attente de révision
   */
  async getDraftsNeedingReview(): Promise<DraftRecord[]> {
    const allDrafts = await this.databaseService.getAllDrafts();
    return allDrafts.filter(d => 
      d.needsManualReview === true && 
      (d.status === 'created' || d.status === 'pending_review')
    );
  }

  /**
   * Récupérer un draft avec ses items pour révision
   */
  async getDraftForReview(draftId: string): Promise<DraftReviewResponse> {
    const draft = await this.databaseService.getDraftById(draftId);
    
    if (!draft) {
      throw new NotFoundException(`Draft ${draftId} non trouvé`);
    }

    // Parser les items depuis le JSON stocké
    let items: PriceRequestItem[] = [];
    if (draft.itemsJson) {
      try {
        items = JSON.parse(draft.itemsJson);
      } catch (e) {
        this.logger.error(`Erreur parsing items JSON: ${e.message}`);
      }
    }

    // Déterminer les champs à réviser
    const fieldsToReview: string[] = [];
    items.forEach(item => {
      if (item.isEstimated) fieldsToReview.push('quantity');
      if (item.needsManualReview) {
        if (!item.supplierCode) fieldsToReview.push('supplierCode');
        if (!item.brand) fieldsToReview.push('brand');
      }
    });

    // URL du PDF original (si disponible)
    let originalPdfUrl: string | undefined;
    if (draft.originalPdfPath && fs.existsSync(draft.originalPdfPath)) {
      originalPdfUrl = `/api/review/pdf/${draftId}`;
    }

    return {
      draft,
      items,
      originalPdfUrl,
      needsManualReview: draft.needsManualReview || false,
      fieldsToReview: [...new Set(fieldsToReview)], // Unique values
    };
  }

  /**
   * Mettre à jour un draft avec les données révisées
   */
  async updateDraftItems(draftId: string, updateData: DraftUpdateRequest): Promise<DraftRecord> {
    const draft = await this.databaseService.getDraftById(draftId);
    
    if (!draft) {
      throw new NotFoundException(`Draft ${draftId} non trouvé`);
    }

    // Valider les items
    if (updateData.items) {
      for (const item of updateData.items) {
        if (!item.description || item.description.trim().length < 3) {
          throw new BadRequestException('Chaque item doit avoir une description');
        }
        if (!item.quantity || item.quantity <= 0) {
          throw new BadRequestException('Chaque item doit avoir une quantité positive');
        }
      }

      // Assigner des IDs aux items si nécessaire
      updateData.items = updateData.items.map((item, idx) => ({
        ...item,
        id: item.id || uuidv4(),
        needsManualReview: false, // Marqué comme révisé
        isEstimated: false,
      }));
    }

    // Mettre à jour le draft
    const updatedDraft = await this.databaseService.updateDraft(draftId, {
      itemsJson: updateData.items ? JSON.stringify(updateData.items) : draft.itemsJson,
      reviewNotes: updateData.reviewNotes,
      status: updateData.status || 'reviewed',
      needsManualReview: false,
      reviewedAt: new Date(),
    });

    // Régénérer le fichier Excel avec les items mis à jour
    if (updateData.items && updateData.items.length > 0) {
      await this.regenerateExcel(updatedDraft, updateData.items);
    }

    this.logger.log(`Draft ${draftId} mis à jour après révision`);
    return updatedDraft;
  }

  /**
   * Régénérer le fichier Excel après révision
   */
  private async regenerateExcel(draft: DraftRecord, items: PriceRequestItem[]): Promise<void> {
    try {
      const priceRequest = {
        requestNumber: draft.internalRfqNumber,
        clientRfqNumber: draft.clientRfqNumber,
        clientName: draft.clientName,
        clientEmail: draft.clientEmail,
        date: draft.createdAt,
        items,
      };

      const result = await this.excelService.generatePriceRequestExcel(priceRequest as any);
      
      // Remplacer l'ancien fichier Excel
      if (fs.existsSync(draft.excelPath)) {
        fs.unlinkSync(draft.excelPath);
      }
      
      // Écrire le nouveau fichier
      fs.writeFileSync(draft.excelPath, result.excelBuffer);
      
      this.logger.log(`Excel régénéré: ${draft.excelPath}`);
    } catch (error) {
      this.logger.error(`Erreur régénération Excel: ${error.message}`);
      throw error;
    }
  }

  /**
   * Récupérer le contenu du PDF original
   */
  async getOriginalPdf(draftId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    const draft = await this.databaseService.getDraftById(draftId);
    
    if (!draft || !draft.originalPdfPath) {
      return null;
    }

    if (!fs.existsSync(draft.originalPdfPath)) {
      this.logger.warn(`PDF non trouvé: ${draft.originalPdfPath}`);
      return null;
    }

    return {
      buffer: fs.readFileSync(draft.originalPdfPath),
      filename: draft.originalPdfFilename || 'original.pdf',
    };
  }

  /**
   * Marquer un draft comme vérifié et prêt à envoyer
   */
  async markAsReviewed(draftId: string, reviewNotes?: string): Promise<DraftRecord> {
    return this.updateDraftItems(draftId, {
      status: 'reviewed',
      reviewNotes,
    });
  }

  /**
   * Ajouter un item à un draft existant
   */
  async addItemToDraft(draftId: string, item: PriceRequestItem): Promise<DraftRecord> {
    const reviewData = await this.getDraftForReview(draftId);
    const items = [...reviewData.items, { ...item, id: uuidv4() }];
    
    return this.updateDraftItems(draftId, { items });
  }

  /**
   * Supprimer un item d'un draft
   */
  async removeItemFromDraft(draftId: string, itemId: string): Promise<DraftRecord> {
    const reviewData = await this.getDraftForReview(draftId);
    const items = reviewData.items.filter(i => i.id !== itemId);
    
    if (items.length === 0) {
      throw new BadRequestException('Impossible de supprimer tous les items');
    }
    
    return this.updateDraftItems(draftId, { items });
  }

  /**
   * Obtenir les statistiques des drafts
   */
  async getReviewStats(): Promise<{
    total: number;
    pendingReview: number;
    reviewed: number;
    sent: number;
  }> {
    const allDrafts = await this.databaseService.getAllDrafts();
    
    return {
      total: allDrafts.length,
      pendingReview: allDrafts.filter(d => d.needsManualReview && d.status !== 'reviewed').length,
      reviewed: allDrafts.filter(d => d.status === 'reviewed').length,
      sent: allDrafts.filter(d => d.status === 'sent_to_procurement' || d.status === 'sent_to_supplier').length,
    };
  }
}
