import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

// Services
import { OfferClassifierService } from './services/offer-classifier.service';
import { BrandMatcherService } from './services/brand-matcher.service';
import { SupplierDirectoryService } from './services/supplier-directory.service';
import { MailSyncService } from './services/mail-sync.service';

// Controllers
import { SupplierCollectorController } from './controllers/supplier-collector.controller';

/**
 * SupplierCollectorModule
 *
 * Module pour la collecte automatique des emails fournisseurs.
 * Analyse les emails SENT/INBOX pour identifier les réponses
 * aux demandes de prix et construit un annuaire Marque → Fournisseurs.
 *
 * Fonctionnalités :
 * - Synchronisation IMAP des dossiers SENT et INBOX
 * - Classification des emails (offre, déclin, en attente)
 * - Détection des marques mentionnées
 * - Consolidation de l'annuaire fournisseurs
 * - Export JSON pour utilisation externe
 * - API REST pour gestion et consultation
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    EmailModule,
  ],
  controllers: [SupplierCollectorController],
  providers: [
    OfferClassifierService,
    BrandMatcherService,
    SupplierDirectoryService,
    MailSyncService,
  ],
  exports: [
    SupplierDirectoryService,
    BrandMatcherService,
  ],
})
export class SupplierCollectorModule {}
