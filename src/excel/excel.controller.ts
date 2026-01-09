import { Controller, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExcelService } from './excel.service';
import { CreatePriceRequestDto } from '../common/dto';
import { PriceRequest } from '../common/interfaces';

@Controller('excel')
export class ExcelController {
  constructor(private readonly excelService: ExcelService) {}

  @Post('generate')
  async generatePriceRequest(@Body() dto: CreatePriceRequestDto, @Res() res: Response) {
    const priceRequest: PriceRequest = {
      requestNumber: this.excelService.generateRequestNumber(),
      date: new Date(),
      supplier: dto.supplier,
      supplierEmail: dto.supplierEmail,
      items: dto.items,
      notes: dto.notes,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
    };

    const result = await this.excelService.generatePriceRequestExcel(priceRequest);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${priceRequest.requestNumber}.xlsx"`);
    res.send(result.excelBuffer);
  }

  @Post('preview')
  async previewPriceRequest(@Body() dto: CreatePriceRequestDto) {
    const priceRequest: PriceRequest = {
      requestNumber: this.excelService.generateRequestNumber(),
      date: new Date(),
      supplier: dto.supplier,
      supplierEmail: dto.supplierEmail,
      items: dto.items,
      notes: dto.notes,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
    };

    const result = await this.excelService.generatePriceRequestExcel(priceRequest);

    return {
      requestNumber: result.priceRequest.requestNumber,
      excelPath: result.excelPath,
      itemsCount: result.priceRequest.items.length,
      supplier: result.priceRequest.supplier,
    };
  }
}
