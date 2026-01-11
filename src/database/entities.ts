// Entité Client/Fournisseur
export interface Client {
  id: string;
  code: string; // Code interne unique
  name: string;
  email: string;
  alternateEmails?: string[];
  phone?: string;
  address?: string;
  contactPerson?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Correspondance RFQ Client -> Interne
export interface RfqMapping {
  id: string;
  clientId?: string;
  clientRfqNumber?: string; // Numéro RFQ du client
  internalRfqNumber: string; // Notre numéro de demande
  emailId?: string; // ID de l'email source (UID IMAP)
  messageId?: string; // Message-ID header (pour déduplication cross-mailbox)
  emailSubject?: string;
  receivedAt?: Date;
  processedAt: Date;
  status: 'pending' | 'processed' | 'draft_pending' | 'sent' | 'completed' | 'error';
  excelPath?: string;
  notes?: string;
  mailbox?: string; // Adresse email qui a reçu le message
}

// Configuration de traitement
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

// Mots-clés pour détecter les demandes de prix
export interface DetectionKeyword {
  id: string;
  keyword: string;
  weight: number; // Poids pour le scoring
  language: 'fr' | 'en' | 'both';
  type: 'subject' | 'body' | 'both';
}

// Historique de traitement
export interface ProcessingLog {
  id: string;
  rfqMappingId?: string;
  emailId: string;
  action: string;
  status: 'success' | 'error' | 'skipped';
  message: string;
  timestamp: Date;
}
