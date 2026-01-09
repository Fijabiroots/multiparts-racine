import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete,
  Body, 
  Param, 
  Res,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ReviewService } from './review.service';
import { PriceRequestItem, DraftUpdateRequest } from '../common/interfaces';

@Controller('api/review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * GET /api/review/pending
   * Récupérer tous les drafts en attente de révision manuelle
   */
  @Get('pending')
  async getPendingReviews() {
    const drafts = await this.reviewService.getDraftsNeedingReview();
    return {
      success: true,
      count: drafts.length,
      drafts,
    };
  }

  /**
   * GET /api/review/stats
   * Statistiques des révisions
   */
  @Get('stats')
  async getStats() {
    const stats = await this.reviewService.getReviewStats();
    return {
      success: true,
      stats,
    };
  }

  /**
   * GET /api/review/:draftId
   * Récupérer un draft spécifique pour révision
   */
  @Get(':draftId')
  async getDraftForReview(@Param('draftId') draftId: string) {
    try {
      const reviewData = await this.reviewService.getDraftForReview(draftId);
      return {
        success: true,
        ...reviewData,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }

  /**
   * GET /api/review/pdf/:draftId
   * Télécharger le PDF original
   */
  @Get('pdf/:draftId')
  async getOriginalPdf(@Param('draftId') draftId: string, @Res() res: Response) {
    const pdf = await this.reviewService.getOriginalPdf(draftId);
    
    if (!pdf) {
      throw new NotFoundException('PDF original non trouvé');
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdf.filename}"`,
      'Content-Length': pdf.buffer.length,
    });
    
    res.send(pdf.buffer);
  }

  /**
   * PUT /api/review/:draftId
   * Mettre à jour un draft avec les données révisées
   */
  @Put(':draftId')
  async updateDraft(
    @Param('draftId') draftId: string,
    @Body() updateData: DraftUpdateRequest,
  ) {
    try {
      const draft = await this.reviewService.updateDraftItems(draftId, updateData);
      return {
        success: true,
        message: 'Draft mis à jour avec succès',
        draft,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }

  /**
   * PUT /api/review/:draftId/items
   * Mettre à jour uniquement les items d'un draft
   */
  @Put(':draftId/items')
  async updateItems(
    @Param('draftId') draftId: string,
    @Body() body: { items: PriceRequestItem[] },
  ) {
    if (!body.items || !Array.isArray(body.items)) {
      throw new BadRequestException('Items invalides');
    }

    const draft = await this.reviewService.updateDraftItems(draftId, { items: body.items });
    return {
      success: true,
      message: `${body.items.length} items mis à jour`,
      draft,
    };
  }

  /**
   * POST /api/review/:draftId/items
   * Ajouter un item à un draft
   */
  @Post(':draftId/items')
  async addItem(
    @Param('draftId') draftId: string,
    @Body() item: PriceRequestItem,
  ) {
    if (!item.description) {
      throw new BadRequestException('Description requise');
    }

    const draft = await this.reviewService.addItemToDraft(draftId, {
      ...item,
      quantity: item.quantity || 1,
      unit: item.unit || 'pcs',
    });

    return {
      success: true,
      message: 'Item ajouté',
      draft,
    };
  }

  /**
   * DELETE /api/review/:draftId/items/:itemId
   * Supprimer un item d'un draft
   */
  @Delete(':draftId/items/:itemId')
  async removeItem(
    @Param('draftId') draftId: string,
    @Param('itemId') itemId: string,
  ) {
    const draft = await this.reviewService.removeItemFromDraft(draftId, itemId);
    return {
      success: true,
      message: 'Item supprimé',
      draft,
    };
  }

  /**
   * POST /api/review/:draftId/approve
   * Approuver un draft et le marquer comme révisé
   */
  @Post(':draftId/approve')
  async approveDraft(
    @Param('draftId') draftId: string,
    @Body() body: { reviewNotes?: string },
  ) {
    const draft = await this.reviewService.markAsReviewed(draftId, body.reviewNotes);
    return {
      success: true,
      message: 'Draft approuvé et prêt à envoyer',
      draft,
    };
  }
}
