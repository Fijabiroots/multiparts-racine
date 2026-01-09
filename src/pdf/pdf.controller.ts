import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  async extractFromPdf(@UploadedFile() file: Express.Multer.File) {
    const result = await this.pdfService.extractFromBuffer(file.buffer, file.originalname);
    return {
      filename: result.filename,
      pages: result.pages,
      itemsFound: result.items.length,
      items: result.items,
      supplierInfo: this.pdfService.extractSupplierInfo(result.text),
      textPreview: result.text.substring(0, 500),
    };
  }
}
