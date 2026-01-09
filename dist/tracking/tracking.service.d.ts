import { ConfigService } from '@nestjs/config';
export interface TrackingEntry {
    timestamp: Date;
    clientRfqNumber?: string;
    internalRfqNumber: string;
    clientName?: string;
    clientEmail: string;
    subject: string;
    itemCount: number;
    status: 'traité' | 'en_attente' | 'erreur' | 'révision_manuelle';
    acknowledgmentSent: boolean;
    deadline?: string;
    notes?: string;
}
export declare class TrackingService {
    private configService;
    private readonly logger;
    private readonly trackingFilePath;
    private workbook;
    constructor(configService: ConfigService);
    private initializeWorkbook;
    private createIndexSheet;
    private getSheetName;
    private getOrCreateDaySheet;
    private reorderSheets;
    addEntry(entry: TrackingEntry): Promise<boolean>;
    private formatStatus;
    private updateIndexStats;
    private reloadWorkbook;
    private saveWorkbook;
    getTrackingFilePath(): string;
    getStatistics(): {
        totalEntries: number;
        todayEntries: number;
        lastUpdate: string;
        sheetCount: number;
    };
    isRfqAlreadyTracked(clientRfqNumber: string, clientEmail: string): boolean;
}
