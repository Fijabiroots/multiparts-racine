/**
 * Système d'intelligence Marque-Fournisseur
 * Gère les relations entre marques, catégories et fournisseurs
 */

/**
 * Catégorie de marque
 */
export interface BrandCategory {
  key: string;
  label: string;
  examples?: string[];
  keywords?: string[];  // Mots-clés pour auto-détection
}

/**
 * Marque
 */
export interface Brand {
  name: string;
  normalizedName: string;  // Nom normalisé pour recherche
  category: string;        // Clé de catégorie
  aliases?: string[];      // Noms alternatifs (ex: "CAT" pour "Caterpillar")
  createdAt: Date;
  updatedAt: Date;
  source: 'initial' | 'auto_detected' | 'manual';  // Comment la marque a été ajoutée
}

/**
 * Relation Fournisseur-Marque
 */
export interface SupplierBrandRelation {
  supplierEmail: string;
  supplierName?: string;
  brandName: string;
  
  // Statistiques
  quotesCount: number;           // Nombre de devis reçus
  successfulQuotes: number;      // Devis avec prix
  declinedCount: number;         // Refus
  averageResponseDays?: number;  // Délai moyen de réponse
  lastQuoteAt?: Date;
  lastDeclineAt?: Date;
  
  // Qualité
  reliability: number;           // 0-100, basé sur les réponses
  isPreferred: boolean;          // Fournisseur préféré pour cette marque
  
  // Metadata
  firstContactAt: Date;
  updatedAt: Date;
  notes?: string;
}

/**
 * Suggestion de fournisseur pour une marque
 */
export interface SupplierSuggestion {
  email: string;
  name?: string;
  brand: string;
  category: string;
  reliability: number;
  quotesCount: number;
  lastActivity?: Date;
  isPreferred: boolean;
  reason: string;  // Pourquoi ce fournisseur est suggéré
}

/**
 * Configuration d'envoi automatique
 */
export interface AutoSendConfig {
  enabled: boolean;
  minReliability: number;       // Score minimum pour auto-send (ex: 60)
  maxSuppliersPerBrand: number; // Max fournisseurs par marque
  excludeDeclined: boolean;     // Exclure ceux qui ont refusé récemment
  declineCooldownDays: number;  // Jours avant de relancer après un refus
}

/**
 * Résultat d'analyse de demande
 */
export interface BrandAnalysisResult {
  detectedBrands: string[];
  newBrands: string[];           // Marques non trouvées dans la base
  suggestedSuppliers: SupplierSuggestion[];
  autoSendEmails: string[];      // Emails pour envoi automatique en CCI
  manualReviewEmails: string[];  // Emails nécessitant validation manuelle
}

/**
 * Structure de la base de données des marques
 */
export interface BrandDatabase {
  version: string;
  lastUpdated: Date;
  categories: BrandCategory[];
  brands: Brand[];
  supplierRelations: SupplierBrandRelation[];
  autoSendConfig: AutoSendConfig;
}

/**
 * Catégories par défaut avec mots-clés de détection
 */
export const DEFAULT_CATEGORIES: BrandCategory[] = [
  {
    key: 'equipements_miniers',
    label: 'Équipements miniers',
    examples: ['Terex', 'Caterpillar', 'Komatsu'],
    keywords: ['mining', 'excavator', 'loader', 'drill', 'crusher', 'minier', 'excavatrice'],
  },
  {
    key: 'composants_hydrauliques',
    label: 'Composants hydrauliques',
    examples: ['Parker', 'Eaton', 'Bosch Rexroth'],
    keywords: ['hydraulic', 'valve', 'cylinder', 'pump', 'hydraulique', 'vanne', 'vérin'],
  },
  {
    key: 'moteurs',
    label: 'Moteurs',
    examples: ['Cummins', 'Perkins', 'Kubota'],
    keywords: ['motor', 'engine', 'moteur', 'diesel', 'electric motor'],
  },
  {
    key: 'transmissions',
    label: 'Transmissions',
    examples: ['Dana', 'ZF', 'Allison'],
    keywords: ['transmission', 'gearbox', 'differential', 'axle', 'boîte de vitesse'],
  },
  {
    key: 'roulements',
    label: 'Roulements',
    examples: ['SKF', 'FAG', 'NSK', 'Timken'],
    keywords: ['bearing', 'roulement', 'ball bearing', 'roller'],
  },
  {
    key: 'pompes',
    label: 'Pompes',
    examples: ['KSB', 'Grundfos', 'Flowserve'],
    keywords: ['pump', 'pompe', 'centrifugal', 'submersible'],
  },
  {
    key: 'filtration',
    label: 'Filtration',
    examples: ['Donaldson', 'Mann-Filter', 'Fleetguard'],
    keywords: ['filter', 'filtre', 'filtration', 'oil filter', 'air filter'],
  },
  {
    key: 'electricite',
    label: 'Électricité & Automatisation',
    examples: ['Siemens', 'ABB', 'Schneider Electric'],
    keywords: ['electric', 'plc', 'automation', 'relay', 'switch', 'électrique', 'automate'],
  },
  {
    key: 'pneumatique',
    label: 'Pneumatique',
    examples: ['Festo', 'SMC', 'Aventics'],
    keywords: ['pneumatic', 'air cylinder', 'pneumatique', 'compressor'],
  },
  {
    key: 'instrumentation',
    label: 'Instrumentation & Mesure',
    examples: ['Endress+Hauser', 'Emerson', 'Yokogawa'],
    keywords: ['sensor', 'gauge', 'transmitter', 'capteur', 'jauge', 'mesure'],
  },
  {
    key: 'autres',
    label: 'Autres (non classés)',
    keywords: [],
  },
];
