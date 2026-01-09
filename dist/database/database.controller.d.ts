import { DatabaseService } from './database.service';
import { Client } from './entities';
export declare class DatabaseController {
    private readonly databaseService;
    constructor(databaseService: DatabaseService);
    getAllClients(): Promise<{
        count: number;
        clients: Client[];
    }>;
    getClient(id: string): Promise<Client | {
        error: string;
    }>;
    getClientByEmail(email: string): Promise<Client | {
        error: string;
    }>;
    createClient(body: {
        code: string;
        name: string;
        email: string;
        alternateEmails?: string[];
        phone?: string;
        address?: string;
        contactPerson?: string;
    }): Promise<{
        success: boolean;
        client: Client | null;
    }>;
    updateClient(id: string, body: Partial<Client>): Promise<{
        error: string;
        success?: undefined;
        client?: undefined;
    } | {
        success: boolean;
        client: Client;
        error?: undefined;
    }>;
    getAllRfqMappings(limit?: string): Promise<{
        count: number;
        mappings: import("./entities").RfqMapping[];
    }>;
    getRfqMapping(id: string): Promise<import("./entities").RfqMapping | {
        error: string;
    }>;
    getRfqMappingByClientRfq(rfqNumber: string): Promise<import("./entities").RfqMapping | {
        error: string;
    }>;
    getRfqMappingByInternalRfq(rfqNumber: string): Promise<import("./entities").RfqMapping | {
        error: string;
    }>;
    getClientRfqMappings(clientId: string): Promise<{
        count: number;
        mappings: import("./entities").RfqMapping[];
    }>;
    getConfig(): Promise<import("./entities").ProcessingConfig | {
        error: string;
    }>;
    updateConfig(body: {
        startDate?: string;
        endDate?: string;
        folders?: string[];
        autoSendDraft?: boolean;
        checkIntervalMinutes?: number;
        isActive?: boolean;
    }): Promise<{
        success: boolean;
        config: import("./entities").ProcessingConfig | null;
    }>;
    getKeywords(): Promise<{
        count: number;
        keywords: import("./entities").DetectionKeyword[];
    }>;
    addKeyword(body: {
        keyword: string;
        weight: number;
        language: 'fr' | 'en' | 'both';
        type: 'subject' | 'body' | 'both';
    }): Promise<{
        success: boolean;
    }>;
    getLogs(limit?: string): Promise<{
        count: number;
        logs: import("./entities").ProcessingLog[];
    }>;
}
