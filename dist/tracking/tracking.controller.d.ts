import { Response } from 'express';
import { TrackingService } from './tracking.service';
export declare class TrackingController {
    private readonly trackingService;
    constructor(trackingService: TrackingService);
    getStatistics(): {
        success: boolean;
        data: {
            totalEntries: number;
            todayEntries: number;
            lastUpdate: string;
            sheetCount: number;
        };
        filePath: string;
    };
    downloadTrackingFile(res: Response): Response<any, Record<string, any>> | undefined;
}
