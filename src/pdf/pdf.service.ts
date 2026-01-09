import { Injectable, Logger } from '@nestjs/common';
import { ExtractedPdfData, PriceRequestItem, EmailAttachment } from '../common/interfaces';

const pdfParse = require('pdf-parse');

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async extractFromBuffer(buffer: Buffer, filename: string): Promise<ExtractedPdfData> {
    try {
      const data = await pdfParse(buffer);
      const text = data.text;

      this.logger.debug(`Texte extrait de ${filename} (${text.length} chars)`);

      // Extraire le numéro de PR/RFQ
      const rfqNumber = this.extractPRNumber(text, filename);

      // Extraire les items selon le format Purchase Requisition
      const items = this.extractPurchaseRequisitionItems(text);
      
      this.logger.log(`${items.length} items extraits de ${filename}`);

      // Extraire les infos supplémentaires
      const additionalInfo = this.extractAdditionalInfo(text);

      return {
        filename,
        text: data.text,
        pages: data.numpages,
        items,
        rfqNumber,
        generalDescription: additionalInfo.generalDescription,
        additionalDescription: additionalInfo.additionalDescription,
        fleetNumber: additionalInfo.fleetNumber,
        serialNumber: additionalInfo.serialNumber,
        recommendedSuppliers: additionalInfo.recommendedSuppliers,
      };
    } catch (error) {
      this.logger.error(`Erreur extraction PDF ${filename}:`, error.message);
      throw error;
    }
  }

  async extractFromAttachment(attachment: EmailAttachment): Promise<ExtractedPdfData> {
    return this.extractFromBuffer(attachment.content, attachment.filename);
  }

  async extractFromAttachments(attachments: EmailAttachment[]): Promise<ExtractedPdfData[]> {
    const pdfAttachments = attachments.filter(
      (att) => att.contentType === 'application/pdf' || att.filename?.toLowerCase().endsWith('.pdf'),
    );

    const results: ExtractedPdfData[] = [];

    for (const attachment of pdfAttachments) {
      try {
        const extracted = await this.extractFromAttachment(attachment);
        if (extracted.items.length > 0) {
          results.push(extracted);
        } else {
          this.logger.warn(`Aucun item extrait de ${attachment.filename}, ajout item générique`);
          results.push({
            ...extracted,
            items: [{
              description: `Voir document joint: ${attachment.filename}`,
              quantity: 1,
              unit: 'pcs',
              notes: 'Consultez le PDF pour les détails',
            }],
          });
        }
      } catch (error) {
        this.logger.warn(`Impossible d'extraire ${attachment.filename}: ${error.message}`);
      }
    }

    return results;
  }

  private extractPRNumber(text: string, filename: string): string | undefined {
    // 1. Pattern "Purchase Requisition No: PR-719"
    const prMatch1 = text.match(/Purchase\s+Requisition\s*No[:\s]+([A-Z]*-?\d+)/i);
    if (prMatch1) {
      return prMatch1[1].startsWith('PR') ? prMatch1[1] : `PR-${prMatch1[1]}`;
    }

    // 2. Pattern "Purchase Requisitions No: 11132259"
    const prMatch2 = text.match(/Purchase\s+Requisitions?\s+No[:\s]+(\d+)/i);
    if (prMatch2) {
      return `PR-${prMatch2[1]}`;
    }

    // 3. Extraire du nom de fichier: "PR 11132259" ou "PR-719"
    const filenameMatch = filename.match(/PR[\s_\-]*(\d+)/i);
    if (filenameMatch) {
      return `PR-${filenameMatch[1]}`;
    }

    // 4. Pattern générique dans le texte
    const genericMatch = text.match(/PR[\s\-_]*(\d+)/i);
    if (genericMatch) {
      return `PR-${genericMatch[1]}`;
    }

    return undefined;
  }

  private extractAdditionalInfo(text: string): {
    generalDescription?: string;
    additionalDescription?: string;
    fleetNumber?: string;
    serialNumber?: string;
    recommendedSuppliers?: string[];
  } {
    const result: any = {};

    // General Description
    const generalMatch = text.match(/General\s+Description[:\s]+([^\n]+)/i);
    if (generalMatch) {
      result.generalDescription = generalMatch[1].trim();
    }

    // Additional Description
    const additionalMatch = text.match(/Additional\s+Description[:\s]+([^\n]+)/i);
    if (additionalMatch) {
      result.additionalDescription = additionalMatch[1].trim();
    }

    // Fleet Number
    const fleetMatch = text.match(/Fleet\s+Number[:\s]+([A-Z0-9]+)/i);
    if (fleetMatch) {
      result.fleetNumber = fleetMatch[1].trim();
    }

    // Serial Number
    const serialMatch = text.match(/SERIAL\s*[:\s]+([A-Z0-9]+)/i);
    if (serialMatch) {
      result.serialNumber = serialMatch[1].trim();
    }

    // Recommended suppliers
    const supplierMatch = text.match(/Recommended\s+supplier[^:]*[:\s]+([^\n]+)/i);
    if (supplierMatch) {
      result.recommendedSuppliers = supplierMatch[1]
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    }

    return result;
  }

  private extractPurchaseRequisitionItems(text: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];

    // Normaliser le texte
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n');

    this.logger.debug(`Analyse de ${lines.length} lignes pour extraction items`);

    // Extraire les infos additionnelles pour la marque
    const additionalInfo = this.extractAdditionalInfo(text);
    const brandFromAdditional = this.extractBrandFromText(additionalInfo.additionalDescription || '');
    const brandFromGeneral = this.extractBrandFromText(additionalInfo.generalDescription || '');
    const detectedBrand = brandFromAdditional || brandFromGeneral;

    // =====================================================
    // MÉTHODE PRINCIPALE: Pattern global pour Endeavour Mining
    // Format: Line Qty UOM ItemCode Description... GLCode Cost Cost
    // Exemple: "10 10 EA 201368 RELAY OVERLOAD... 1500405 0 0"
    // =====================================================

    // Map pour stocker les items trouvés (éviter doublons)
    const foundItems: Map<string, { qty: number; unit: string; desc: string; lineNum: string }> = new Map();

    // Pattern pour les lignes principales
    // Format avec espaces: "10 10 EA 201368 RELAY..."
    // Format sans espaces (pdf-parse): "1010EA201368RELAY..."
    const mainLinePattern = /\b(\d{1,2})(\d{1,4})(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)(\d{5,8})([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s*1500\d+|\s+\d+\s*USD|\s*$)/gi;
    
    // Pattern alternatif avec espaces
    const spacedPattern = /\b(\d{1,3})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT|LOT)\s+(\d{5,8})\s+([A-Z][A-Z0-9\s\-\.\/\&\,\(\)]+?)(?:\s+1500\d+|\s+\d+\s+\d+\s*(USD|EUR|XOF)?|\s*$)/gi;

    let match;
    
    // Essayer d'abord le pattern sans espaces (pdf-parse compacte souvent le texte)
    while ((match = mainLinePattern.exec(cleanText)) !== null) {
      const lineNum = match[1];
      const qty = parseInt(match[2], 10);
      const unit = match[3];
      const itemCode = match[4];
      let description = match[5].trim();

      // Nettoyer la description
      description = description.replace(/\s*1500\d+.*$/i, '').trim();
      description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
      description = description.replace(/\s+0\s+0\s*$/i, '').trim();
      description = description.replace(/\s+\d+\s*USD.*$/i, '').trim();
      description = description.replace(/\s{2,}/g, ' ').trim();

      if (description.length > 5 && !foundItems.has(itemCode)) {
        foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
        this.logger.debug(`Item trouvé (compact): Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
      }
    }
    
    // Si rien trouvé, essayer le pattern avec espaces
    if (foundItems.size === 0) {
      while ((match = spacedPattern.exec(cleanText)) !== null) {
        const lineNum = match[1];
        const qty = parseInt(match[2], 10);
        const unit = match[3];
        const itemCode = match[4];
        let description = match[5].trim();

        // Nettoyer la description
        description = description.replace(/\s+1500\d+.*$/i, '').trim();
        description = description.replace(/\s+\d+\s+\d+\s*(USD|EUR|XOF)?.*$/i, '').trim();
        description = description.replace(/\s+0\s+0\s*$/i, '').trim();
        description = description.replace(/\s{2,}/g, ' ').trim();

        if (description.length > 5 && !foundItems.has(itemCode)) {
          foundItems.set(itemCode, { qty, unit, desc: description, lineNum });
          this.logger.debug(`Item trouvé (espacé): Code=${itemCode}, Qty=${qty}, Desc="${description.substring(0, 50)}..."`);
        }
      }
    }

    // Pour chaque item trouvé, collecter les lignes de continuation
    for (const [itemCode, data] of foundItems) {
      const itemIndex = cleanText.indexOf(itemCode);
      if (itemIndex > -1) {
        const afterItem = cleanText.substring(itemIndex);
        const continuationLines: string[] = [];
        const afterLines = afterItem.split('\n').slice(1);

        for (const contLine of afterLines) {
          const trimmed = contLine.trim();
          
          // Arrêter sur marqueurs de fin
          if (!trimmed || 
              trimmed.match(/^(Additional|Total|Page|\d{1,3}\s+\d+\s+(EA|PCS))/i)) {
            break;
          }
          
          // Ignorer les headers et devises
          if (trimmed.match(/^(Line|Quantity|UOM|Item|Sub|Activity|GL|Code|Cost|USD|EUR|XOF)/i)) {
            continue;
          }
          
          // Ajouter si commence par une lettre
          if (trimmed.match(/^[A-Z]/i) && trimmed.length > 3) {
            let addText = trimmed.replace(/\s+(USD|EUR|XOF).*$/i, '').trim();
            addText = addText.replace(/\s+\d+\s*$/i, '').trim();
            if (addText.length > 3) {
              continuationLines.push(addText);
            }
          }
        }

        // Construire la description complète
        let fullDesc = data.desc;
        for (const cont of continuationLines) {
          if (!fullDesc.toLowerCase().includes(cont.toLowerCase().substring(0, 15))) {
            fullDesc += ' ' + cont;
          }
        }

        // Nettoyer les répétitions (format "DESC - DESC")
        const parts = fullDesc.split(' - ');
        if (parts.length === 2 && parts[0].toLowerCase().substring(0, 20) === parts[1].toLowerCase().substring(0, 20)) {
          fullDesc = parts[0].trim();
        }

        fullDesc = fullDesc.replace(/\s{2,}/g, ' ').trim();

        // Extraire code fournisseur et marque
        const supplierCode = this.extractSupplierCodeFromDescription(fullDesc);
        const brand = detectedBrand || this.extractBrandFromDescription(fullDesc);

        this.logger.debug(`Item finalisé: Code=${itemCode}, SupplierCode=${supplierCode}, Brand=${brand}, Desc="${fullDesc.substring(0, 60)}..."`);

        items.push({
          reference: supplierCode || itemCode,
          internalCode: itemCode,
          supplierCode: supplierCode,
          brand: brand,
          description: fullDesc,
          quantity: data.qty,
          unit: data.unit === 'EA' ? 'pcs' : data.unit.toLowerCase(),
        });
      }
    }

    // Si aucun item trouvé, essayer méthode alternative ligne par ligne
    if (items.length === 0) {
      this.logger.debug('Méthode principale sans résultat, essai méthode alternative');
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Pattern alternatif
        const altMatch = trimmed.match(/^(\d{1,2})\s+(\d+)\s+(EA|PCS|PC|KG|M|L|SET|UNIT)\s+(\d{5,6})\s+([A-Z].+)/i);
        
        if (altMatch) {
          const qty = parseInt(altMatch[2], 10);
          const unit = altMatch[3];
          const itemCode = altMatch[4];
          let description = altMatch[5].trim();

          // Nettoyer
          description = description.replace(/\s+1500\d+.*$/i, '').trim();
          description = description.replace(/\s+\d+\s+(USD|EUR|XOF).*$/i, '').trim();

          if (description.length > 5 && !items.some(i => i.internalCode === itemCode)) {
            const supplierCode = this.extractSupplierCodeFromDescription(description);
            const brand = detectedBrand || this.extractBrandFromDescription(description);

            items.push({
              reference: supplierCode || itemCode,
              internalCode: itemCode,
              supplierCode: supplierCode,
              brand: brand,
              description: description,
              quantity: qty,
              unit: unit === 'EA' ? 'pcs' : unit.toLowerCase(),
            });
          }
        }
      }
    }

    this.logger.log(`Extraction terminée: ${items.length} items trouvés`);
    return items;
  }

  private extractSupplierCodeFromDescription(description: string): string | undefined {
    // Patterns pour codes fournisseur
    // Ex: "SCHNEIDER LRD325", "SKF 6205-2RS", "PARKER PVS25"
    
    // Pattern 1: Marque suivie d'un code alphanumérique
    const brandCodePattern = /\b(SCHNEIDER|SIEMENS|ABB|SKF|PARKER|CATERPILLAR|CAT|KOMATSU|SANDVIK|ATLAS|BOSCH|DANFOSS|EATON|GATES|TIMKEN|NSK|FAG|NTN|REXROTH|HYDAC|MAHLE|MANN|DONALDSON|FLEETGUARD|BALDWIN|WIX)\s+([A-Z0-9][\w\-\.\/]+)/i;
    const brandMatch = description.match(brandCodePattern);
    if (brandMatch) {
      return brandMatch[2];
    }

    // Pattern 2: Code à la fin après la marque (ex: "RELAY OVERLOAD THERMAL SCHNEIDER LRD325")
    const endCodePattern = /\b([A-Z]{2,}[\-]?[A-Z0-9]*[\d]+[A-Z0-9\-]*)\s*$/i;
    const endMatch = description.match(endCodePattern);
    if (endMatch && endMatch[1].length >= 4) {
      // Vérifier que ce n'est pas juste un mot
      if (/\d/.test(endMatch[1])) {
        return endMatch[1];
      }
    }

    // Pattern 3: Codes avec tirets ou formats spéciaux
    const specialCodePattern = /\b([A-Z]{1,3}[\-][A-Z0-9\-]+|[A-Z0-9]+[\-][A-Z0-9\-]+)\b/i;
    const specialMatch = description.match(specialCodePattern);
    if (specialMatch && specialMatch[1].length >= 5 && /\d/.test(specialMatch[1])) {
      return specialMatch[1];
    }

    return undefined;
  }

  private extractBrandFromDescription(description: string): string | undefined {
    const brands = [
      'SCHNEIDER', 'SIEMENS', 'ABB', 'SKF', 'PARKER', 'CATERPILLAR', 'CAT',
      'KOMATSU', 'SANDVIK', 'ATLAS COPCO', 'ATLAS', 'BOSCH', 'REXROTH',
      'DANFOSS', 'EATON', 'GATES', 'TIMKEN', 'NSK', 'FAG', 'NTN',
      'HYDAC', 'MAHLE', 'MANN', 'DONALDSON', 'FLEETGUARD', 'BALDWIN', 'WIX',
      'CUMMINS', 'PERKINS', 'DEUTZ', 'VOLVO', 'SCANIA', 'MERCEDES', 'MAN',
      'ZF', 'ALLISON', 'DANA', 'CARRARO', 'KAWASAKI', 'LINDE', 'LIEBHERR',
      'TEREX', 'GROVE', 'MANITOU', 'JCB', 'CASE', 'NEW HOLLAND', 'JOHN DEERE',
      'HITACHI', 'KOBELCO', 'SUMITOMO', 'HYUNDAI', 'DOOSAN', 'BOBCAT',
    ];

    const upperDesc = description.toUpperCase();
    for (const brand of brands) {
      if (upperDesc.includes(brand)) {
        return brand;
      }
    }

    return undefined;
  }

  private extractBrandFromText(text: string): string | undefined {
    if (!text) return undefined;
    return this.extractBrandFromDescription(text);
  }

  /**
   * Extraire les infos fournisseur depuis le texte
   */
  extractSupplierInfo(text: string): {
    name?: string;
    recommendedSuppliers?: string[];
    brands?: string[];
  } {
    const result: any = {};

    // Extraire le nom de l'entreprise
    const companyPatterns = [
      /SOCIETE\s+DES\s+MINES\s+[^\n]+/i,
      /ENDEAVOUR\s+MINING/i,
      /Company[:\s]+([^\n]+)/i,
      /From[:\s]+([^\n<]+)/i,
    ];
    
    for (const pattern of companyPatterns) {
      const nameMatch = text.match(pattern);
      if (nameMatch) {
        result.name = nameMatch[0].trim();
        break;
      }
    }

    // Recommended suppliers
    const supplierMatch = text.match(/Recommended\s+supplier[^:]*[:\s]+([^\n]+)/i);
    if (supplierMatch) {
      result.recommendedSuppliers = supplierMatch[1]
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    }

    // Extraire les marques détectées
    const brands = new Set<string>();
    const brandList = [
      'SCHNEIDER', 'SIEMENS', 'ABB', 'SKF', 'PARKER', 'CATERPILLAR', 'CAT',
      'KOMATSU', 'SANDVIK', 'ATLAS COPCO', 'ATLAS', 'BOSCH', 'REXROTH',
      'DANFOSS', 'EATON', 'GATES', 'TIMKEN', 'NSK', 'FAG', 'NTN',
      'HYDAC', 'MAHLE', 'MANN', 'DONALDSON', 'FLEETGUARD', 'BALDWIN', 'WIX',
    ];
    
    const upperText = text.toUpperCase();
    for (const brand of brandList) {
      if (upperText.includes(brand)) {
        brands.add(brand);
      }
    }
    
    if (brands.size > 0) {
      result.brands = Array.from(brands);
    }

    return result;
  }

  /**
   * Extraire les items depuis le corps de l'email
   */
  extractItemsFromEmailBody(body: string): PriceRequestItem[] {
    const items: PriceRequestItem[] = [];
    
    if (!body) return items;

    const lines = body.split('\n').filter(l => l.trim());

    // Patterns pour détecter des items dans un email
    const patterns = [
      // Pattern: Quantité x Description
      /^(\d+)\s*[xX×]\s*(.{10,})/,
      // Pattern: Description : Quantité
      /^(.{10,}?)\s*:\s*(\d+)\s*(pcs?|unités?|ea)?/i,
      // Pattern avec tiret
      /^[-•]\s*(\d+)\s*[xX×]?\s*(.{10,})/,
      // Pattern numéroté
      /^\d+[.\)]\s*(.{10,}?)\s*[-–:]\s*(\d+)/,
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10 || trimmed.length > 500) continue;

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          let description: string;
          let quantity: number;

          if (pattern.source.startsWith('^(\\d+)')) {
            // Quantité en premier
            quantity = parseInt(match[1], 10);
            description = match[2].trim();
          } else {
            // Description en premier
            description = match[1].trim();
            quantity = parseInt(match[2], 10) || 1;
          }

          if (description.length > 5 && quantity > 0) {
            items.push({
              description,
              quantity,
              unit: 'pcs',
            });
            break;
          }
        }
      }
    }

    return items;
  }
}
