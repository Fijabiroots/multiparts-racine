export interface Client {
    id: string;
    code: string;
    name: string;
    email: string;
    alternateEmails?: string[];
    phone?: string;
    address?: string;
    contactPerson?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface RfqMapping {
    id: string;
    clientId?: string;
    clientRfqNumber?: string;
    internalRfqNumber: string;
    emailId?: string;
    emailSubject?: string;
    receivedAt?: Date;
    processedAt: Date;
    status: 'pending' | 'processed' | 'draft_pending' | 'sent' | 'completed' | 'error';
    excelPath?: string;
    notes?: string;
}
export interface ProcessingConfig {
    id: string;
    startDate?: Date;
    endDate?: Date;
    folders: string[];
    autoSendDraft: boolean;
    checkIntervalMinutes: number;
    lastProcessedAt?: Date;
    isActive: boolean;
}
export interface DetectionKeyword {
    id: string;
    keyword: string;
    weight: number;
    language: 'fr' | 'en' | 'both';
    type: 'subject' | 'body' | 'both';
}
export interface ProcessingLog {
    id: string;
    rfqMappingId?: string;
    emailId: string;
    action: string;
    status: 'success' | 'error' | 'skipped';
    message: string;
    timestamp: Date;
}
