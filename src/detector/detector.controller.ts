import { Controller, Post, Body, Get } from '@nestjs/common';
import { DetectorService } from './detector.service';
import { ParsedEmail } from '../common/interfaces';

@Controller('detector')
export class DetectorController {
  constructor(private readonly detectorService: DetectorService) {}

  @Post('analyze')
  async analyzeEmail(@Body() body: { subject: string; body: string; attachments?: Array<{ filename: string }> }) {
    const mockEmail: ParsedEmail = {
      id: 'test',
      from: 'test@example.com',
      to: 'me@example.com',
      subject: body.subject,
      date: new Date(),
      body: body.body,
      attachments: (body.attachments || []).map(a => ({
        filename: a.filename,
        contentType: 'application/octet-stream',
        content: Buffer.from(''),
        size: 0,
      })),
    };

    const result = await this.detectorService.analyzeEmail(mockEmail);
    return result;
  }

  @Get('refresh-keywords')
  async refreshKeywords() {
    await this.detectorService.refreshKeywords();
    return { 
      success: true, 
      keywordsCount: this.detectorService.getKeywordsCount() 
    };
  }
}
