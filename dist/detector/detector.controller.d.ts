import { DetectorService } from './detector.service';
export declare class DetectorController {
    private readonly detectorService;
    constructor(detectorService: DetectorService);
    analyzeEmail(body: {
        subject: string;
        body: string;
        attachments?: Array<{
            filename: string;
        }>;
    }): Promise<import("./detector.service").DetectionResult>;
    refreshKeywords(): Promise<{
        success: boolean;
        keywordsCount: number;
    }>;
}
