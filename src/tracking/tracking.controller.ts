import { Controller, Get, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { TrackingService } from './tracking.service';
import * as fs from 'fs';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  /**
   * GET /tracking/stats
   * Retourne les statistiques de suivi
   */
  @Get('stats')
  getStatistics() {
    const stats = this.trackingService.getStatistics();
    return {
      success: true,
      data: stats,
      filePath: this.trackingService.getTrackingFilePath(),
    };
  }

  /**
   * GET /tracking/download
   * Télécharge le fichier de suivi Excel
   */
  @Get('download')
  downloadTrackingFile(@Res() res: Response) {
    const filePath = this.trackingService.getTrackingFilePath();

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Fichier de suivi non trouvé',
      });
    }

    const fileName = `suivi-rfq-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  }

  /**
   * POST /tracking/reset
   * Réinitialise le fichier de suivi (MODE TEST)
   */
  @Post('reset')
  resetTracking(@Body() body?: { confirm?: boolean }) {
    if (!body?.confirm) {
      return {
        error: 'Confirmation requise',
        message: 'Envoyez { "confirm": true } pour confirmer la réinitialisation',
        warning: 'Cette action supprimera toutes les entrées du fichier de suivi',
      };
    }

    const result = this.trackingService.resetTracking();
    return {
      success: result.success,
      message: result.success ? 'Fichier de suivi réinitialisé' : 'Erreur lors de la réinitialisation',
      previousStats: result.previousStats,
    };
  }
}
