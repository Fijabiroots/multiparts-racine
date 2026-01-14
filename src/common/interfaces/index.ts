export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
}

export interface ParsedEmail {
  id: string;
  messageId?: string;        // Message-ID header pour le threading
  from: string;
  to: string | string[];     // Peut être string ou array
  cc?: string[];             // Destinataires en copie
  replyTo?: string;          // Reply-To header
  inReplyTo?: string;        // In-Reply-To header (réponse directe)
  references?: string[];     // References header pour le threading (chaîne de messages)
  subject: string;
  date: Date;
  body: string;
  attachments: EmailAttachment[];
}

export interface ExtractedPdfData {
  filename: string;
  text: string;
  pages?: number;
  items: PriceRequestItem[];
  rfqNumber?: string;
  generalDescription?: string;
  additionalDescription?: string;
  fleetNumber?: string;
  serialNumber?: string;
  recommendedSuppliers?: string[];
  supplierInfo?: { name?: string; email?: string };
  needsVerification?: boolean;      // true si OCR ou extraction incertaine
  extractionMethod?: string;        // 'pdftotext' | 'pdf-parse' | 'ocr' | 'filename'
}

export interface PriceRequestItem {
  id?: string;                  // ID unique pour l'édition
  reference?: string;           // Code à utiliser (supplierCode si disponible, sinon internalCode)
  internalCode?: string;        // Code interne client (ex: 144850)
  supplierCode?: string;        // Code fournisseur/fabricant (ex: HTM-56-4T, 710 0321)
  brand?: string;               // Marque (ex: HTM, SKF, TEREX)
  description: string;
  quantity: number;
  unit?: string;
  notes?: string;               // Infos additionnelles (serial, fleet, etc.)
  serialNumber?: string;        // Numéro de série de l'équipement
  needsManualReview?: boolean;  // true si quantité/infos à vérifier manuellement
  isEstimated?: boolean;        // true si quantité estimée (non lue du document)
  originalLine?: number;        // Numéro de ligne dans le document original
  isBulletListItem?: boolean;   // true si extrait d'une liste à puces - évite la fusion
  isEmailTableItem?: boolean;   // true si extrait d'un tableau dans le corps de l'email
  // LLM Parser fields
  unitPrice?: number;           // Prix unitaire
  totalPrice?: number;          // Prix total ligne
  currency?: string;            // Devise (USD, EUR, XOF)
  needsReview?: boolean;        // Alias pour needsManualReview (LLM compatibility)
}

/**
 * Exigences client détectées dans l'email
 */
export interface ClientRequirements {
  responseDeadline?: string;      // Délai de réponse exigé par le client (ex: "48h", "avant le 15/01")
  responseDeadlineDate?: Date;    // Date calculée du délai de réponse
  replyToEmail?: string;          // Adresse email de réponse spécifique exigée
  urgent?: boolean;               // Demande marquée comme urgente
  otherRequirements?: string[];   // Autres exigences détectées
}

export interface PriceRequest {
  requestNumber: string;
  clientRfqNumber?: string;
  clientName?: string;
  clientEmail?: string;
  date: Date;
  supplier?: string;
  supplierEmail?: string;
  items: PriceRequestItem[];
  notes?: string;
  deadline?: Date;
  responseDeadlineHours?: number;
  sourceEmail?: ParsedEmail;
  additionalAttachments?: EmailAttachment[]; // Pièces jointes complémentaires (images, etc.)
  fleetNumber?: string;
  serialNumber?: string;
  needsManualReview?: boolean;   // true si au moins un item nécessite révision
  extractionMethod?: string;     // Méthode d'extraction utilisée
  clientRequirements?: ClientRequirements; // Exigences spécifiques du client
}

export interface GeneratedPriceRequest {
  priceRequest: PriceRequest;
  excelPath: string;
  excelBuffer: Buffer;
}

// Types de pièces jointes
export type AttachmentType = 'rfq_pdf' | 'image' | 'document' | 'other';

export function getAttachmentType(contentType: string, filename: string): AttachmentType {
  const lowerFilename = filename.toLowerCase();
  const lowerType = contentType.toLowerCase();
  
  if (lowerType.includes('pdf') || lowerFilename.endsWith('.pdf')) {
    return 'rfq_pdf';
  }
  if (lowerType.includes('image') || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(lowerFilename)) {
    return 'image';
  }
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(lowerFilename)) {
    return 'document';
  }
  return 'other';
}

// Statuts des brouillons
export type DraftStatus = 
  | 'created'               // Brouillon créé
  | 'pending_review'        // En attente de vérification manuelle
  | 'reviewed'              // Vérifié et complété
  | 'sent_to_procurement'   // Envoyé à procurement
  | 'sent_to_supplier'      // Envoyé au fournisseur
  | 'completed';            // Terminé

export interface DraftRecord {
  id: string;
  internalRfqNumber: string;
  clientRfqNumber?: string;
  clientName?: string;
  clientEmail?: string;
  excelPath: string;
  status: DraftStatus;
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  sentTo?: string;
  // Nouveaux champs pour stockage PDF et révision manuelle
  originalPdfPath?: string;         // Chemin vers le PDF original
  originalPdfFilename?: string;     // Nom du fichier PDF original
  needsManualReview?: boolean;      // Nécessite vérification manuelle
  extractionMethod?: string;        // Méthode d'extraction (pdftotext, ocr, filename)
  reviewNotes?: string;             // Notes de révision
  reviewedAt?: Date;                // Date de révision
  reviewedBy?: string;              // Qui a révisé
  itemsJson?: string;               // Items en JSON pour édition
}

// Interface pour la mise à jour manuelle d'un draft
export interface DraftUpdateRequest {
  items?: PriceRequestItem[];
  reviewNotes?: string;
  status?: DraftStatus;
}

// Interface pour la réponse de l'API de révision
export interface DraftReviewResponse {
  draft: DraftRecord;
  items: PriceRequestItem[];
  originalPdfUrl?: string;
  needsManualReview: boolean;
  fieldsToReview: string[];       // Liste des champs à vérifier (ex: ['quantity', 'description'])
}

// Configuration de l'application
export interface AppConfig {
  defaultRecipient: string;           // procurement@multipartsci.com
  responseDeadlineHours: number;      // 24h par défaut
  checkIntervalMinutes: number;       // 5 minutes
  autoSendToProcurement: boolean;     // true
  readEndDate?: Date;                 // Date limite de lecture des emails
  requireManualReviewForOcr: boolean; // true = bloquer envoi auto si OCR
}

/**
 * Données extraites d'un document (format unifié LLM Parser)
 */
export interface ExtractedDocumentData {
  filename: string;
  type: 'pdf' | 'excel' | 'word' | 'email' | 'image';
  text: string;
  items: PriceRequestItem[];
  rfqNumber?: string;
  needsVerification?: boolean;
  extractionMethod?: string;
  deadline?: string;
  contactName?: string;
  isUrgent?: boolean;
}
