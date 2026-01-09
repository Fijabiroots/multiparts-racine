import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { DraftService, PriceRequestDraftOptions } from './draft.service';
import { RfqLanguage, getRfqInstructions, RFQ_INSTRUCTIONS_FR, RFQ_INSTRUCTIONS_EN } from '../common/rfq-instructions';
import { COMPANY_INFO, getCompanyHeader, getAddressBlock } from '../common/company-info';

@Controller('drafts')
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  /**
   * GET /drafts
   * Lister les brouillons
   */
  @Get()
  async listDrafts(@Query('limit') limit?: string) {
    const drafts = await this.draftService.listDrafts(
      limit ? parseInt(limit, 10) : 10
    );
    return {
      success: true,
      count: drafts.length,
      data: drafts,
    };
  }

  /**
   * GET /drafts/rfq-instructions
   * Obtenir les instructions RFQ dans la langue souhaitée
   */
  @Get('rfq-instructions')
  getRfqInstructions(@Query('language') language?: RfqLanguage) {
    return {
      success: true,
      language: language || 'both',
      html: getRfqInstructions(language || 'both'),
      availableLanguages: ['fr', 'en', 'both'],
    };
  }

  /**
   * GET /drafts/rfq-instructions/preview
   * Prévisualisation des instructions RFQ en HTML
   */
  @Get('rfq-instructions/preview')
  previewRfqInstructions(@Query('language') language?: RfqLanguage) {
    const lang = language || 'both';
    const header = getCompanyHeader();
    const instructions = getRfqInstructions(lang);
    const address = getAddressBlock();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Instructions RFQ - MULTIPARTS</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; }
  </style>
</head>
<body>
  ${header}
  <h2>Instructions RFQ (${lang === 'fr' ? 'Français' : lang === 'en' ? 'English' : 'Bilingue'})</h2>
  ${instructions}
  <h3>Adresse de livraison</h3>
  ${address}
</body>
</html>`;
  }

  /**
   * GET /drafts/company-info
   * Obtenir les informations de la société
   */
  @Get('company-info')
  getCompanyInfo() {
    return {
      success: true,
      data: COMPANY_INFO,
      templates: {
        header: getCompanyHeader(),
        addressBlock: getAddressBlock(),
      },
    };
  }

  /**
   * GET /drafts/languages
   * Lister les langues disponibles pour les RFQ
   */
  @Get('languages')
  getAvailableLanguages() {
    return {
      success: true,
      data: [
        { code: 'fr', name: 'Français', description: 'Instructions en français uniquement' },
        { code: 'en', name: 'English', description: 'Instructions in English only' },
        { code: 'both', name: 'Bilingue', description: 'Instructions in both French and English' },
      ],
      default: 'both',
      autoDetection: {
        enabled: true,
        description: 'La langue peut être détectée automatiquement basée sur le domaine email du destinataire',
        frenchDomains: ['.fr', '.be', '.ch', '.ca', '.lu', '.ci', '.sn', '.ml'],
        englishDomains: ['.uk', '.us', '.au', '.nz', '.ie', '.za', '.ng'],
      },
    };
  }

  /**
   * POST /drafts/test
   * Créer un brouillon de test
   */
  @Post('test')
  async createTestDraft(
    @Body() body: {
      to?: string;
      language?: RfqLanguage;
    }
  ) {
    const to = body.to || 'test@example.com';
    const language = body.language || 'both';

    const result = await this.draftService.saveToDrafts({
      to,
      subject: `[TEST] Instructions RFQ - MULTIPARTS (${language})`,
      body: 'Ceci est un email de test.',
      htmlBody: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
${getCompanyHeader()}
<p>Ceci est un email de test pour prévisualiser les instructions RFQ.</p>
${getRfqInstructions(language)}
${getAddressBlock()}
</body>
</html>
`,
    });

    return {
      success: result.success,
      message: result.success 
        ? `Brouillon de test créé avec succès (langue: ${language})` 
        : `Erreur: ${result.error}`,
      to,
      language,
    };
  }
}
