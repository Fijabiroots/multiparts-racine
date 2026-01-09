import { Response } from 'express';
import { ExcelService } from './excel.service';
import { CreatePriceRequestDto } from '../common/dto';
export declare class ExcelController {
    private readonly excelService;
    constructor(excelService: ExcelService);
    generatePriceRequest(dto: CreatePriceRequestDto, res: Response): Promise<void>;
    previewPriceRequest(dto: CreatePriceRequestDto): Promise<{
        requestNumber: string;
        excelPath: string;
        itemsCount: number;
        supplier: string | undefined;
    }>;
}
