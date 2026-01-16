import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { v4 as uuidv4 } from 'uuid';
import {
  BrandMatch,
  BrandSupplierMapping,
  SupplierEmail,
  DirectoryStats,
  ExportSimple,
  ExportDetailed,
  BrandSupplierRecord,
} from '../interfaces/supplier-collector.interfaces';

/**
 * SupplierDirectoryService
 *
 * Gère l'annuaire Marque → Fournisseurs
 * Stocke et consolide les associations marque-email fournisseur
 */
@Injectable()
export class SupplierDirectoryService {
  private readonly logger = new Logger(SupplierDirectoryService.name);

  constructor(private databaseService: DatabaseService) {}

  /**
   * Ajoute ou met à jour une association marque-fournisseur
   */
  async upsertBrandSupplier(
    brandMatch: BrandMatch,
    supplierEmail: string,
    supplierName: string | undefined,
    evidenceMessageId: string,
    evidenceReasons: string[],
  ): Promise<void> {
    const normalizedEmail = supplierEmail.toLowerCase().trim();
    const now = new Date().toISOString();

    // Vérifier si l'association existe
    const existing = await this.findByBrandAndEmail(brandMatch.brandName, normalizedEmail);

    if (existing) {
      // Calculer la nouvelle confiance (moyenne pondérée)
      const newConfidence =
        (existing.confidence * existing.offerCount + brandMatch.confidence) /
        (existing.offerCount + 1);

      // Mettre à jour
      this.databaseService['db'].run(
        `
        UPDATE brand_supplier_mapping
        SET
          last_seen_at = ?,
          offer_count = offer_count + 1,
          confidence = ?,
          evidence_message_id = ?,
          evidence_reasons = ?,
          updated_at = ?
        WHERE id = ?
      `,
        [
          now,
          newConfidence,
          evidenceMessageId,
          JSON.stringify(evidenceReasons),
          now,
          existing.id,
        ],
      );

      this.logger.debug(
        `Updated: ${brandMatch.brandName} → ${normalizedEmail} (count: ${existing.offerCount + 1}, conf: ${newConfidence.toFixed(2)})`,
      );
    } else {
      // Créer une nouvelle association
      const id = uuidv4();

      this.databaseService['db'].run(
        `
        INSERT INTO brand_supplier_mapping
        (id, brand_name, category, supplier_email, supplier_name, confidence, offer_count,
         first_seen_at, last_seen_at, evidence_message_id, evidence_reasons, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          id,
          brandMatch.brandName,
          brandMatch.category,
          normalizedEmail,
          supplierName || null,
          brandMatch.confidence,
          1,
          now,
          now,
          evidenceMessageId,
          JSON.stringify(evidenceReasons),
          now,
          now,
        ],
      );

      this.logger.log(`New: ${brandMatch.brandName} → ${normalizedEmail}`);
    }

    this.databaseService.saveToFile();
  }

  /**
   * Récupère les fournisseurs pour une marque
   */
  async getSuppliersForBrand(brandName: string): Promise<SupplierEmail[]> {
    const result = this.databaseService['db'].exec(
      `
      SELECT * FROM brand_supplier_mapping
      WHERE brand_name = ?
      ORDER BY confidence DESC, offer_count DESC
    `,
      [brandName],
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    return result[0].values.map((row: any[]) => this.mapRowToSupplierEmail(result[0].columns, row));
  }

  /**
   * Récupère les fournisseurs pour plusieurs marques
   */
  async getSuppliersForBrands(brandNames: string[]): Promise<Map<string, SupplierEmail[]>> {
    const result = new Map<string, SupplierEmail[]>();

    for (const brandName of brandNames) {
      const suppliers = await this.getSuppliersForBrand(brandName);
      if (suppliers.length > 0) {
        result.set(brandName, suppliers);
      }
    }

    return result;
  }

  /**
   * Récupère tous les emails uniques de fournisseurs pour des marques
   */
  async getUniqueSupplierEmailsForBrands(brandNames: string[]): Promise<string[]> {
    if (brandNames.length === 0) return [];

    const placeholders = brandNames.map(() => '?').join(',');
    const result = this.databaseService['db'].exec(
      `
      SELECT DISTINCT supplier_email
      FROM brand_supplier_mapping
      WHERE brand_name IN (${placeholders})
      AND confidence >= 0.5
      ORDER BY supplier_email
    `,
      brandNames,
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    return result[0].values.map((row: any[]) => row[0] as string);
  }

  /**
   * Exporte l'annuaire complet (format simple)
   */
  async exportSimple(): Promise<ExportSimple> {
    const result = this.databaseService['db'].exec(`
      SELECT brand_name, category, supplier_email
      FROM brand_supplier_mapping
      WHERE confidence >= 0.5
      ORDER BY brand_name, confidence DESC
    `);

    const brandsMap = new Map<string, { category: string; emails: Set<string> }>();

    if (result.length > 0) {
      for (const row of result[0].values) {
        const brandName = row[0] as string;
        const category = row[1] as string;
        const email = row[2] as string;

        if (!brandsMap.has(brandName)) {
          brandsMap.set(brandName, { category, emails: new Set() });
        }
        brandsMap.get(brandName)!.emails.add(email);
      }
    }

    const brands = Array.from(brandsMap.entries()).map(([brand, data]) => ({
      brand,
      category: data.category,
      supplierEmails: Array.from(data.emails),
    }));

    const totalSuppliers = new Set(
      brands.flatMap(b => b.supplierEmails),
    ).size;

    return {
      generatedAt: new Date().toISOString(),
      totalBrands: brands.length,
      totalSuppliers,
      brands,
    };
  }

  /**
   * Exporte l'annuaire complet (format détaillé)
   */
  async exportDetailed(): Promise<ExportDetailed> {
    const result = this.databaseService['db'].exec(`
      SELECT * FROM brand_supplier_mapping
      WHERE confidence >= 0.3
      ORDER BY brand_name, confidence DESC
    `);

    const brandsMap = new Map<string, { category: string; suppliers: SupplierEmail[] }>();

    if (result.length > 0) {
      for (const row of result[0].values) {
        const record = this.mapRowToRecord(result[0].columns, row);

        if (!brandsMap.has(record.brandName)) {
          brandsMap.set(record.brandName, { category: record.category || '', suppliers: [] });
        }

        brandsMap.get(record.brandName)!.suppliers.push({
          email: record.supplierEmail,
          name: record.supplierName,
          confidence: record.confidence,
          offerCount: record.offerCount,
          firstSeenAt: new Date(record.firstSeenAt),
          lastSeenAt: new Date(record.lastSeenAt),
          evidenceMessageId: record.evidenceMessageId,
          evidenceReasons: JSON.parse(record.evidenceReasons || '[]'),
        });
      }
    }

    const brands = Array.from(brandsMap.entries()).map(([brand, data]) => ({
      brand,
      category: data.category,
      suppliers: data.suppliers.map(s => ({
        email: s.email,
        name: s.name,
        confidence: s.confidence,
        offerCount: s.offerCount,
        lastSeenAt: s.lastSeenAt.toISOString(),
        firstSeenAt: s.firstSeenAt.toISOString(),
      })),
    }));

    const allEmails = new Set<string>();
    brands.forEach(b => b.suppliers.forEach(s => allEmails.add(s.email)));

    return {
      generatedAt: new Date().toISOString(),
      totalBrands: brands.length,
      totalSuppliers: allEmails.size,
      brands,
    };
  }

  /**
   * Retourne les statistiques de l'annuaire
   */
  async getStats(): Promise<DirectoryStats> {
    // Nombre de marques avec au moins un fournisseur
    const brandsResult = this.databaseService['db'].exec(`
      SELECT COUNT(DISTINCT brand_name) as count FROM brand_supplier_mapping
    `);
    const totalBrands = brandsResult.length > 0 ? brandsResult[0].values[0][0] as number : 0;

    // Nombre total de fournisseurs uniques
    const suppliersResult = this.databaseService['db'].exec(`
      SELECT COUNT(DISTINCT supplier_email) as count FROM brand_supplier_mapping
    `);
    const totalSuppliers = suppliersResult.length > 0 ? suppliersResult[0].values[0][0] as number : 0;

    // Nombre total d'emails analysés
    const emailsResult = this.databaseService['db'].exec(`
      SELECT COUNT(*) as count FROM supplier_emails
    `);
    const totalEmails = emailsResult.length > 0 ? emailsResult[0].values[0][0] as number : 0;

    // Nombre d'offres détectées
    const offersResult = this.databaseService['db'].exec(`
      SELECT COUNT(*) as count FROM supplier_emails WHERE classification = 'OFFER'
    `);
    const totalOffers = offersResult.length > 0 ? offersResult[0].values[0][0] as number : 0;

    // Moyenne de fournisseurs par marque
    const avgSuppliers = totalBrands > 0 ? totalSuppliers / totalBrands : 0;

    // Top 10 marques par nombre de fournisseurs
    const topResult = this.databaseService['db'].exec(`
      SELECT brand_name, COUNT(DISTINCT supplier_email) as supplier_count
      FROM brand_supplier_mapping
      GROUP BY brand_name
      ORDER BY supplier_count DESC
      LIMIT 10
    `);

    const topBrands = topResult.length > 0
      ? topResult[0].values.map((row: any[]) => ({
          brand: row[0] as string,
          supplierCount: row[1] as number,
        }))
      : [];

    // Dernière sync
    const lastSyncResult = this.databaseService['db'].exec(`
      SELECT MAX(completed_at) as last FROM supplier_sync_logs WHERE status = 'completed'
    `);
    const lastSyncAt = lastSyncResult.length > 0 && lastSyncResult[0].values[0][0]
      ? new Date(lastSyncResult[0].values[0][0] as string)
      : undefined;

    return {
      totalBrands,
      totalSuppliers,
      totalEmails,
      totalOffers,
      brandsWithSuppliers: totalBrands,
      avgSuppliersPerBrand: parseFloat(avgSuppliers.toFixed(2)),
      lastSyncAt,
      topBrands,
    };
  }

  // ============ PRIVATE METHODS ============

  private async findByBrandAndEmail(
    brandName: string,
    email: string,
  ): Promise<BrandSupplierRecord | null> {
    const result = this.databaseService['db'].exec(
      `SELECT * FROM brand_supplier_mapping WHERE brand_name = ? AND supplier_email = ?`,
      [brandName, email],
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    return this.mapRowToRecord(result[0].columns, result[0].values[0]);
  }

  private mapRowToRecord(columns: string[], row: any[]): BrandSupplierRecord {
    const obj: any = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });

    return {
      id: obj.id,
      brandName: obj.brand_name,
      category: obj.category,
      supplierEmail: obj.supplier_email,
      supplierName: obj.supplier_name,
      confidence: obj.confidence,
      offerCount: obj.offer_count,
      firstSeenAt: obj.first_seen_at,
      lastSeenAt: obj.last_seen_at,
      evidenceMessageId: obj.evidence_message_id,
      evidenceReasons: obj.evidence_reasons,
      createdAt: obj.created_at,
      updatedAt: obj.updated_at,
    };
  }

  private mapRowToSupplierEmail(columns: string[], row: any[]): SupplierEmail {
    const record = this.mapRowToRecord(columns, row);
    return {
      email: record.supplierEmail,
      name: record.supplierName,
      confidence: record.confidence,
      offerCount: record.offerCount,
      firstSeenAt: new Date(record.firstSeenAt),
      lastSeenAt: new Date(record.lastSeenAt),
      evidenceMessageId: record.evidenceMessageId,
      evidenceReasons: JSON.parse(record.evidenceReasons || '[]'),
    };
  }
}
