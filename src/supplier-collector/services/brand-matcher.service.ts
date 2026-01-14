import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  BrandMatch,
  BrandEntry,
  MatchSource,
  SyncedEmail,
} from '../interfaces/supplier-collector.interfaces';

interface BrandsJsonCategory {
  key: string;
  label: string;
  examples?: string[];
  brands: string[];
}

interface BrandsJson {
  generated_at_utc: string;
  source_file: string;
  total_unique_brands: number;
  categories: BrandsJsonCategory[];
}

/**
 * BrandMatcherService
 *
 * Charge les marques depuis le fichier JSON et détecte
 * les marques mentionnées dans les emails.
 */
@Injectable()
export class BrandMatcherService implements OnModuleInit {
  private readonly logger = new Logger(BrandMatcherService.name);
  private brands: BrandEntry[] = [];
  private brandsJsonPath: string;
  private lastRefresh: Date | null = null;

  constructor(private configService: ConfigService) {
    this.brandsJsonPath = path.join(
      process.cwd(),
      'data',
      'brands_grouped_by_category.json'
    );
  }

  async onModuleInit() {
    await this.refreshBrands();
  }

  /**
   * Recharge les marques depuis le fichier JSON
   */
  async refreshBrands(): Promise<void> {
    try {
      if (!fs.existsSync(this.brandsJsonPath)) {
        this.logger.warn(`Fichier marques non trouvé: ${this.brandsJsonPath}`);
        return;
      }

      const content = fs.readFileSync(this.brandsJsonPath, 'utf-8');
      const data: BrandsJson = JSON.parse(content);

      this.brands = [];

      for (const category of data.categories) {
        for (const brandName of category.brands) {
          // Créer les patterns de recherche
          const patterns = this.createBrandPatterns(brandName);

          this.brands.push({
            name: brandName,
            category: category.key,
            categoryLabel: category.label,
            patterns,
          });
        }
      }

      this.lastRefresh = new Date();
      this.logger.log(`${this.brands.length} marques chargées depuis ${data.source_file}`);
    } catch (error) {
      this.logger.error(`Erreur chargement marques: ${error.message}`);
    }
  }

  /**
   * Trouve les marques dans un email
   */
  findBrandsInEmail(email: SyncedEmail): BrandMatch[] {
    const matches: BrandMatch[] = [];
    const matchedBrands = new Set<string>();

    // 1. Chercher dans le sujet (haute confiance)
    for (const brand of this.brands) {
      if (matchedBrands.has(brand.name)) continue;

      const subjectMatch = this.findMatch(email.subject, brand);
      if (subjectMatch) {
        matches.push({
          brandName: brand.name,
          category: brand.category,
          matchSource: MatchSource.SUBJECT,
          matchedText: subjectMatch,
          confidence: 1.0,
        });
        matchedBrands.add(brand.name);
      }
    }

    // 2. Chercher dans les noms de pièces jointes (bonne confiance)
    for (const att of email.attachments) {
      for (const brand of this.brands) {
        if (matchedBrands.has(brand.name)) continue;

        const attMatch = this.findMatch(att.filename, brand);
        if (attMatch) {
          matches.push({
            brandName: brand.name,
            category: brand.category,
            matchSource: MatchSource.ATTACHMENT_NAME,
            matchedText: attMatch,
            confidence: 0.9,
          });
          matchedBrands.add(brand.name);
        }
      }
    }

    // 3. Chercher dans le corps (confiance moyenne)
    if (email.bodyText) {
      for (const brand of this.brands) {
        if (matchedBrands.has(brand.name)) continue;

        const bodyMatch = this.findMatch(email.bodyText, brand);
        if (bodyMatch) {
          matches.push({
            brandName: brand.name,
            category: brand.category,
            matchSource: MatchSource.BODY,
            matchedText: bodyMatch,
            confidence: 0.7,
          });
          matchedBrands.add(brand.name);
        }
      }
    }

    return matches;
  }

  /**
   * Vérifie si une marque existe dans le JSON
   */
  brandExists(brandName: string): boolean {
    const normalizedName = brandName.toLowerCase().trim();
    return this.brands.some(b => b.name.toLowerCase() === normalizedName);
  }

  /**
   * Ajoute une nouvelle marque au fichier JSON
   */
  async addBrand(brandName: string, category: string): Promise<boolean> {
    try {
      if (!fs.existsSync(this.brandsJsonPath)) {
        this.logger.error('Fichier marques non trouvé');
        return false;
      }

      const content = fs.readFileSync(this.brandsJsonPath, 'utf-8');
      const data: BrandsJson = JSON.parse(content);

      // Trouver la catégorie
      let categoryObj = data.categories.find(c => c.key === category);

      if (!categoryObj) {
        // Créer une nouvelle catégorie "autres" si n'existe pas
        categoryObj = {
          key: 'autres',
          label: 'Autres',
          brands: [],
        };
        data.categories.push(categoryObj);
      }

      // Ajouter la marque si elle n'existe pas
      if (!categoryObj.brands.includes(brandName)) {
        categoryObj.brands.push(brandName);
        categoryObj.brands.sort();
        data.total_unique_brands++;
        data.generated_at_utc = new Date().toISOString();

        // Sauvegarder
        fs.writeFileSync(this.brandsJsonPath, JSON.stringify(data, null, 2), 'utf-8');

        // Recharger le cache
        await this.refreshBrands();

        this.logger.log(`Marque "${brandName}" ajoutée à la catégorie "${category}"`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Erreur ajout marque: ${error.message}`);
      return false;
    }
  }

  /**
   * Retourne toutes les marques
   */
  getAllBrands(): BrandEntry[] {
    return this.brands;
  }

  /**
   * Retourne les statistiques
   */
  getStats(): { total: number; categories: number; lastRefresh: Date | null } {
    const categories = new Set(this.brands.map(b => b.category));
    return {
      total: this.brands.length,
      categories: categories.size,
      lastRefresh: this.lastRefresh,
    };
  }

  // ============ PRIVATE METHODS ============

  /**
   * Crée les patterns regex pour une marque
   */
  private createBrandPatterns(brandName: string): RegExp[] {
    const patterns: RegExp[] = [];

    // Échapper les caractères spéciaux regex
    const escaped = this.escapeRegex(brandName);

    // Pattern exact avec word boundaries
    patterns.push(new RegExp(`\\b${escaped}\\b`, 'i'));

    // Pour les noms composés (ex: "Bosch Rexroth"), ajouter un pattern sans tiret/espace
    if (brandName.includes(' ') || brandName.includes('-')) {
      const normalized = escaped.replace(/[\s\-]+/g, '[\\s\\-]*');
      patterns.push(new RegExp(`\\b${normalized}\\b`, 'i'));
    }

    return patterns;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Trouve un match pour une marque dans un texte
   */
  private findMatch(text: string, brand: BrandEntry): string | null {
    if (!text) return null;

    for (const pattern of brand.patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }
}
