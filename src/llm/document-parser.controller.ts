import { 
  Controller, 
  Post, 
  UseInterceptors, 
  UploadedFile, 
  Body, 
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentExtractionService, TenantConfig } from './document-extraction.service';
import { CanonicalDocument } from './universal-llm-parser.service';

// ============================================================
// CONFIGURATION TENANTS (normalement en DB)
// ============================================================

const TENANT_CONFIGS: Record<string, TenantConfig> = {
  'endeavour-mining': {
    tenantId: 'endeavour-mining',
    companyName: 'Endeavour Mining / Société des Mines d\'Ity',
    itemCodePattern: '\\d{5,6}',
    glCodePattern: '1500\\d{3}',
    preferredLanguage: 'fr',
  },
  'caterpillar-dealer': {
    tenantId: 'caterpillar-dealer',
    companyName: 'Caterpillar Dealer',
    itemCodePattern: '[A-Z]{2,3}-\\d{6}',
    preferredLanguage: 'en',
  },
  'generic': {
    tenantId: 'generic',
    companyName: 'Generic Client',
    // Pas de patterns spécifiques - LLM détecte tout automatiquement
  },
};

// ============================================================
// CONTROLLER
// ============================================================

@Controller('api/documents')
export class DocumentParserController {
  private readonly logger = new Logger(DocumentParserController.name);

  constructor(private extractionService: DocumentExtractionService) {}

  /**
   * Parse un document unique
   * 
   * Headers:
   *   x-tenant-id: endeavour-mining (optionnel)
   * 
   * Body: multipart/form-data avec file
   */
  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  async parseDocument(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CanonicalDocument> {
    if (!file) {
      throw new BadRequestException('Fichier requis');
    }

    this.logger.log(`Parsing: ${file.originalname} (tenant: ${tenantId || 'generic'})`);

    // Récupérer config tenant (ou generic par défaut)
    const tenantConfig = tenantId 
      ? TENANT_CONFIGS[tenantId] || TENANT_CONFIGS['generic']
      : undefined;

    const result = await this.extractionService.extractDocument(
      {
        content: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      },
      tenantConfig
    );

    return result;
  }

  /**
   * Parse plusieurs documents et fusionne les résultats
   * Utile pour emails avec plusieurs pièces jointes
   */
  @Post('parse-batch')
  @UseInterceptors(FileInterceptor('files'))
  async parseBatch(
    @UploadedFile() files: Express.Multer.File[],
    @Headers('x-tenant-id') tenantId?: string,
    @Body('merge') merge?: string,
  ): Promise<CanonicalDocument | CanonicalDocument[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Au moins un fichier requis');
    }

    const tenantConfig = tenantId 
      ? TENANT_CONFIGS[tenantId] 
      : undefined;

    const inputs = files.map(f => ({
      content: f.buffer,
      filename: f.originalname,
      mimeType: f.mimetype,
    }));

    if (merge === 'true') {
      return this.extractionService.extractAndMerge(inputs, tenantConfig);
    }

    return this.extractionService.extractDocuments(inputs, tenantConfig);
  }
}

// ============================================================
// EXEMPLE D'UTILISATION DANS UN SERVICE MÉTIER
// ============================================================

import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceRequestService {
  constructor(private extractionService: DocumentExtractionService) {}

  /**
   * Exemple: Traiter un email avec pièces jointes
   */
  async processIncomingEmail(
    emailContent: string,
    attachments: Array<{ filename: string; content: Buffer }>,
    senderDomain: string,
  ) {
    // 1. Détecter le tenant depuis le domaine email
    const tenantConfig = this.detectTenantFromEmail(senderDomain);

    // 2. Parser toutes les pièces jointes
    const inputs = attachments.map(a => ({
      content: a.content,
      filename: a.filename,
    }));

    // 3. Extraire et fusionner
    const document = await this.extractionService.extractAndMerge(inputs, tenantConfig);

    // 4. Exploiter le résultat normalisé
    console.log(`
      Document: ${document.document_number}
      Type: ${document._meta.detected_type}
      Langue: ${document._meta.detected_language}
      Items: ${document.items.length}
      Confiance: ${document._meta.confidence_score}%
    `);

    // 5. Créer la demande de prix dans ton système
    // Tous les champs sont normalisés peu importe le client source!
    for (const item of document.items) {
      console.log(`
        - ${item.quantity} x ${item.unit_of_measure}
        - Code: ${item.item_code || 'N/A'}
        - Description: ${item.description}
        - Prix: ${item.unit_price ? `${item.unit_price} ${item.currency}` : 'À définir'}
      `);
    }

    return document;
  }

  private detectTenantFromEmail(domain: string): TenantConfig | undefined {
    const domainMapping: Record<string, string> = {
      'endeavourmining.com': 'endeavour-mining',
      'smi.ci': 'endeavour-mining',
      'cat.com': 'caterpillar-dealer',
    };

    const tenantId = domainMapping[domain.toLowerCase()];
    return tenantId ? TENANT_CONFIGS[tenantId] : TENANT_CONFIGS['generic'];
  }
}
