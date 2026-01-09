import { ConfigService } from '@nestjs/config';
import { PriceRequest, GeneratedPriceRequest } from '../common/interfaces';
export declare class ExcelService {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService);
    generatePriceRequestExcel(priceRequest: PriceRequest): Promise<GeneratedPriceRequest>;
    private addHeader;
    private addFooter;
    generateRequestNumber(): string;
}
