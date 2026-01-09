import { PriceRequestService } from './price-request.service';
import { ProcessEmailDto } from '../common/dto';
export declare class PriceRequestController {
    private readonly priceRequestService;
    constructor(priceRequestService: PriceRequestService);
    processEmail(dto: ProcessEmailDto, folder?: string): Promise<{
        success: boolean;
        error: string | undefined;
        email: {
            id: string;
            from: string;
            subject: string;
        } | undefined;
        priceRequest: {
            requestNumber: string;
            itemsCount: number;
            supplier: string | undefined;
            deadline: Date | undefined;
        } | undefined;
        excelPath: string | undefined;
        draftSaved: boolean | undefined;
    }>;
    processAllUnread(folder?: string): Promise<{
        summary: {
            processed: number;
            successful: number;
            failed: number;
        };
        results: {
            success: boolean;
            error: string | undefined;
            emailId: string | undefined;
            emailSubject: string | undefined;
            requestNumber: string | undefined;
            draftSaved: boolean | undefined;
        }[];
    }>;
    getPreview(emailId: string, folder?: string): Promise<any>;
}
