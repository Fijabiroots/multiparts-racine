import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { PriceRequestService } from './price-request.service';
import { ProcessEmailDto } from '../common/dto';

@Controller('price-request')
export class PriceRequestController {
  constructor(private readonly priceRequestService: PriceRequestService) {}

  @Post('process')
  async processEmail(@Body() dto: ProcessEmailDto, @Query('folder') folder?: string) {
    const result = await this.priceRequestService.processEmailById(
      dto.emailId,
      folder || 'INBOX',
      dto.supplierEmail,
    );

    return {
      success: result.success,
      error: result.error,
      email: result.email
        ? {
            id: result.email.id,
            from: result.email.from,
            subject: result.email.subject,
          }
        : undefined,
      priceRequest: result.priceRequest
        ? {
            requestNumber: result.priceRequest.requestNumber,
            itemsCount: result.priceRequest.items.length,
            supplier: result.priceRequest.supplier,
            deadline: result.priceRequest.deadline,
          }
        : undefined,
      excelPath: result.generatedExcel?.excelPath,
      draftSaved: result.draftSaved,
    };
  }

  @Post('process-all')
  async processAllUnread(@Query('folder') folder?: string) {
    const result = await this.priceRequestService.processUnreadEmails(folder || 'INBOX');

    return {
      summary: {
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
      },
      results: result.results.map((r) => ({
        success: r.success,
        error: r.error,
        emailId: r.email?.id,
        emailSubject: r.email?.subject,
        requestNumber: r.priceRequest?.requestNumber,
        draftSaved: r.draftSaved,
      })),
    };
  }

  @Get('preview/:emailId')
  async getPreview(@Param('emailId') emailId: string, @Query('folder') folder?: string) {
    return this.priceRequestService.generatePreview(emailId, folder || 'INBOX');
  }
}
