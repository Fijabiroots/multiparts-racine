/**
 * Supplier Collector Module Interfaces
 *
 * Module pour collecter les emails des fournisseurs ayant répondu
 * à des demandes de prix et construire un annuaire Marque → Fournisseurs
 */

// ============ EMAIL CLASSIFICATION ============

export enum MessageClassification {
  OFFER = 'OFFER',           // Offre commerciale détectée
  DECLINED = 'DECLINED',     // Déclin explicite
  NO_OFFER = 'NO_OFFER',     // Pas d'offre détectée
  PENDING = 'PENDING',       // Accusé de réception sans offre
  UNPROCESSED = 'UNPROCESSED', // Non encore traité
}

export enum MatchSource {
  SUBJECT = 'SUBJECT',
  BODY = 'BODY',
  ATTACHMENT_NAME = 'ATTACHMENT_NAME',
}

// ============ SCORING ============

export interface ClassificationResult {
  classification: MessageClassification;
  score: number;
  reasons: string[];
}

export interface ScoringRule {
  pattern: RegExp;
  score: number;
  reason: string;
}

// ============ BRAND MATCHING ============

export interface BrandMatch {
  brandName: string;
  category: string;
  matchSource: MatchSource;
  matchedText: string;
  confidence: number;
}

export interface BrandEntry {
  name: string;
  category: string;
  categoryLabel: string;
  patterns: RegExp[];
}

// ============ SUPPLIER DIRECTORY ============

export interface SupplierEmail {
  email: string;
  name?: string;
  confidence: number;
  offerCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  evidenceMessageId?: string;
  evidenceReasons: string[];
}

export interface BrandSupplierMapping {
  brandName: string;
  category: string;
  suppliers: SupplierEmail[];
}

// ============ SYNC ============

export interface SyncedEmail {
  id: string;
  messageId: string;
  threadId?: string;
  fromEmail: string;
  fromName?: string;
  toEmails: string[];
  subject: string;
  date: Date;
  bodyText?: string;
  attachments: SyncedAttachment[];
  folder: 'INBOX' | 'SENT';
  isRead: boolean;
}

export interface SyncedAttachment {
  filename: string;
  mimeType: string;
  size?: number;
  isInline: boolean;
}

export interface SyncResult {
  accountEmail: string;
  folder: 'INBOX' | 'SENT';
  messagesFound: number;
  messagesNew: number;
  messagesSkipped: number;
  offersDetected: number;
  brandsMatched: number;
  errors: string[];
  duration: number;
}

export interface SyncStatus {
  lastSyncAt?: Date;
  lastSyncResult?: SyncResult;
  isRunning: boolean;
  nextScheduledSync?: Date;
}

// ============ API RESPONSES ============

export interface ExportSimple {
  generatedAt: string;
  totalBrands: number;
  totalSuppliers: number;
  brands: {
    brand: string;
    category: string;
    supplierEmails: string[];
  }[];
}

export interface ExportDetailed {
  generatedAt: string;
  totalBrands: number;
  totalSuppliers: number;
  brands: {
    brand: string;
    category: string;
    suppliers: {
      email: string;
      name?: string;
      confidence: number;
      offerCount: number;
      lastSeenAt: string;
      firstSeenAt: string;
    }[];
  }[];
}

export interface DirectoryStats {
  totalBrands: number;
  totalSuppliers: number;
  totalEmails: number;
  totalOffers: number;
  brandsWithSuppliers: number;
  avgSuppliersPerBrand: number;
  lastSyncAt?: Date;
  topBrands: { brand: string; supplierCount: number }[];
}

// ============ DATABASE MODELS ============

export interface SupplierEmailRecord {
  id: string;
  messageId: string;
  accountEmail: string;
  folder: 'INBOX' | 'SENT';
  fromEmail: string;
  fromName?: string;
  toEmails: string;  // JSON array
  subject: string;
  date: Date;
  bodySnippet?: string;
  attachmentCount: number;
  attachmentNames?: string;  // JSON array
  classification: MessageClassification;
  classificationScore: number;
  classificationReasons: string;  // JSON array
  processedAt?: Date;
  createdAt: Date;
}

export interface BrandSupplierRecord {
  id: string;
  brandName: string;
  category: string;
  supplierEmail: string;
  supplierName?: string;
  confidence: number;
  offerCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  evidenceMessageId?: string;
  evidenceReasons: string;  // JSON array
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierSyncLogRecord {
  id: string;
  accountEmail: string;
  folder: string;
  syncType: 'incremental' | 'full';
  startedAt: Date;
  completedAt?: Date;
  messagesFound: number;
  messagesNew: number;
  messagesSkipped: number;
  offersDetected: number;
  brandsMatched: number;
  status: 'running' | 'completed' | 'error';
  errorMessage?: string;
}
