"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ReminderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReminderService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const nodemailer = require("nodemailer");
const fs = require("fs");
const rfq_lifecycle_service_1 = require("./rfq-lifecycle.service");
const webhook_service_1 = require("../webhook/webhook.service");
const company_info_1 = require("../common/company-info");
let ReminderService = ReminderService_1 = class ReminderService {
    constructor(configService, rfqLifecycleService, webhookService) {
        this.configService = configService;
        this.rfqLifecycleService = rfqLifecycleService;
        this.webhookService = webhookService;
        this.logger = new common_1.Logger(ReminderService_1.name);
        this.signature = '';
        this.initializeTransporter();
        this.loadSignature();
    }
    initializeTransporter() {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get('smtp.host'),
            port: this.configService.get('smtp.port'),
            secure: this.configService.get('smtp.secure', false),
            auth: {
                user: this.configService.get('smtp.user'),
                pass: this.configService.get('smtp.password'),
            },
        });
    }
    loadSignature() {
        const sigPath = this.configService.get('email.defaultSignaturePath', './signature.html');
        if (fs.existsSync(sigPath)) {
            this.signature = fs.readFileSync(sigPath, 'utf-8');
        }
        else {
            const c = company_info_1.COMPANY_INFO.contact;
            const addr = company_info_1.COMPANY_INFO.address;
            this.signature = `
<br>--<br>
<b>${c.name}</b><br>
${c.title}<br>
<b>${company_info_1.COMPANY_INFO.name}</b><br><br>
${addr.line1}<br>
${addr.line2}<br>
${addr.city}, ${addr.country}<br><br>
Tél: ${c.phone}<br>
Mobile: ${c.mobile}<br>
Email: <a href="mailto:${c.primaryEmail}">${c.primaryEmail}</a>
`;
        }
    }
    async scheduledReminderCheck() {
        const enabled = this.configService.get('reminder.enabled', true);
        if (!enabled) {
            return;
        }
        this.logger.log('🔔 Vérification des relances automatiques...');
        await this.processReminders();
    }
    async processReminders() {
        const results = [];
        const maxReminders = this.configService.get('reminder.maxReminders', 3);
        const daysBetween = this.configService.get('reminder.daysBetweenReminders', 2);
        const suppliersToRemind = this.rfqLifecycleService.getSuppliersNeedingReminder(maxReminders, daysBetween);
        this.logger.log(`${suppliersToRemind.length} fournisseur(s) à relancer`);
        for (const supplier of suppliersToRemind) {
            try {
                const rfq = this.rfqLifecycleService.getRfqByNumber(supplier.rfqNumber);
                if (!rfq)
                    continue;
                const success = await this.sendReminder(supplier, rfq);
                if (success) {
                    this.rfqLifecycleService.markSupplierReminded(supplier.rfqNumber, supplier.email);
                    await this.webhookService.emitReminderSent(supplier.rfqNumber, supplier.email, supplier.reminderCount + 1);
                    if (supplier.reminderCount + 1 >= maxReminders) {
                        await this.webhookService.emit(webhook_service_1.WebhookEventType.REMINDER_MAX_REACHED, {
                            rfqNumber: supplier.rfqNumber,
                            supplierEmail: supplier.email,
                            reminderCount: supplier.reminderCount + 1,
                            maxReminders,
                        }, { rfqNumber: supplier.rfqNumber, supplierEmail: supplier.email });
                    }
                }
                else {
                    await this.webhookService.emit(webhook_service_1.WebhookEventType.REMINDER_FAILED, {
                        rfqNumber: supplier.rfqNumber,
                        supplierEmail: supplier.email,
                        error: 'Échec envoi',
                    }, { rfqNumber: supplier.rfqNumber, supplierEmail: supplier.email });
                }
                results.push({
                    supplierEmail: supplier.email,
                    rfqNumber: supplier.rfqNumber,
                    success,
                    reminderCount: supplier.reminderCount + 1,
                });
            }
            catch (error) {
                this.logger.error(`Erreur relance ${supplier.email}: ${error.message}`);
                results.push({
                    supplierEmail: supplier.email,
                    rfqNumber: supplier.rfqNumber,
                    success: false,
                    reminderCount: supplier.reminderCount,
                    error: error.message,
                });
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (results.length > 0) {
            const successCount = results.filter(r => r.success).length;
            this.logger.log(`✅ Relances: ${successCount}/${results.length} envoyées`);
        }
        return results;
    }
    async sendReminder(supplier, rfq) {
        try {
            const isFirstReminder = supplier.reminderCount === 0;
            const isUrgent = rfq.deadline && new Date(rfq.deadline) < new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
            const { subject, htmlBody, textBody } = this.generateReminderContent(supplier, rfq, isFirstReminder, isUrgent || false);
            const mailOptions = {
                from: this.configService.get('smtp.from', 'procurement@multipartsci.com'),
                to: supplier.email,
                subject,
                text: textBody,
                html: htmlBody,
                replyTo: this.configService.get('smtp.replyTo', 'procurement@multipartsci.com'),
            };
            await this.transporter.sendMail(mailOptions);
            this.logger.log(`📧 Relance #${supplier.reminderCount + 1} envoyée à ${supplier.email} pour ${rfq.internalRfqNumber}`);
            return true;
        }
        catch (error) {
            this.logger.error(`Erreur envoi relance: ${error.message}`);
            return false;
        }
    }
    generateReminderContent(supplier, rfq, isFirstReminder, isUrgent) {
        const reminderNumber = supplier.reminderCount + 1;
        const urgentPrefix = isUrgent ? '⚠️ URGENT - ' : '';
        const reminderPrefix = isFirstReminder ? 'Relance: ' : `Relance ${reminderNumber}: `;
        const subject = `${urgentPrefix}${reminderPrefix}${rfq.subject}`;
        const consultedDate = new Date(supplier.consultedAt).toLocaleDateString('fr-FR');
        const daysSince = Math.floor((Date.now() - new Date(supplier.consultedAt).getTime()) / (1000 * 60 * 60 * 24));
        const deadlineText = rfq.deadline
            ? `<p style="color: #d9534f;"><strong>Date limite de réponse: ${new Date(rfq.deadline).toLocaleDateString('fr-FR')}</strong></p>`
            : '';
        const urgentText = isUrgent
            ? `<p style="color: #d9534f; font-weight: bold;">⚠️ Cette demande est urgente et nécessite une réponse rapide.</p>`
            : '';
        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #f0ad4e; padding-bottom: 10px; margin-bottom: 20px; }
    .highlight { background-color: #fcf8e3; padding: 15px; border-left: 4px solid #f0ad4e; margin: 15px 0; }
    .urgent { color: #d9534f; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="color: #f0ad4e; margin: 0;">🔔 Relance - Demande de Prix</h2>
    </div>
    
    <p>Bonjour,</p>
    
    <p>Nous nous permettons de vous relancer concernant notre demande de prix envoyée le <strong>${consultedDate}</strong> (il y a ${daysSince} jours).</p>
    
    <div class="highlight">
      <strong>📋 Référence de la demande:</strong><br>
      • N° Interne: ${rfq.internalRfqNumber}<br>
      ${rfq.clientRfqNumber ? `• N° Client: ${rfq.clientRfqNumber}<br>` : ''}
      • Objet: ${rfq.subject}<br>
      ${rfq.itemCount ? `• Nombre d'articles: ${rfq.itemCount}<br>` : ''}
    </div>
    
    ${urgentText}
    ${deadlineText}
    
    <p>Nous serions reconnaissants si vous pouviez nous faire parvenir votre offre dans les meilleurs délais, ou nous informer si vous n'êtes pas en mesure de répondre à cette demande.</p>
    
    <p>En cas de difficulté ou pour toute question, n'hésitez pas à nous contacter.</p>
    
    <p>Dans l'attente de votre retour, nous vous prions d'agréer nos salutations distinguées.</p>
    
    ${this.signature}
  </div>
</body>
</html>`;
        const textBody = `
RELANCE - DEMANDE DE PRIX

Bonjour,

Nous nous permettons de vous relancer concernant notre demande de prix envoyée le ${consultedDate} (il y a ${daysSince} jours).

RÉFÉRENCE DE LA DEMANDE:
- N° Interne: ${rfq.internalRfqNumber}
${rfq.clientRfqNumber ? `- N° Client: ${rfq.clientRfqNumber}` : ''}
- Objet: ${rfq.subject}
${rfq.itemCount ? `- Nombre d'articles: ${rfq.itemCount}` : ''}

${isUrgent ? '⚠️ Cette demande est urgente et nécessite une réponse rapide.\n' : ''}
${rfq.deadline ? `Date limite de réponse: ${new Date(rfq.deadline).toLocaleDateString('fr-FR')}\n` : ''}

Nous serions reconnaissants si vous pouviez nous faire parvenir votre offre dans les meilleurs délais, ou nous informer si vous n'êtes pas en mesure de répondre à cette demande.

En cas de difficulté ou pour toute question, n'hésitez pas à nous contacter.

Dans l'attente de votre retour, nous vous prions d'agréer nos salutations distinguées.

--
Service Approvisionnement
MULTIPARTS CI
procurement@multipartsci.com
`;
        return { subject, htmlBody, textBody };
    }
    async sendManualReminder(rfqNumber, supplierEmail) {
        const rfq = this.rfqLifecycleService.getRfqByNumber(rfqNumber);
        if (!rfq) {
            this.logger.warn(`RFQ ${rfqNumber} non trouvé`);
            return false;
        }
        const supplier = rfq.suppliers.find(s => s.email === supplierEmail);
        if (!supplier) {
            this.logger.warn(`Fournisseur ${supplierEmail} non trouvé pour ${rfqNumber}`);
            return false;
        }
        return this.sendReminder(supplier, rfq);
    }
    getReminderStatus() {
        const maxReminders = this.configService.get('reminder.maxReminders', 3);
        const daysBetween = this.configService.get('reminder.daysBetweenReminders', 2);
        const pending = this.rfqLifecycleService.getSuppliersNeedingReminder(maxReminders, daysBetween);
        let sentToday = 0;
        const today = new Date().toDateString();
        for (const rfq of this.rfqLifecycleService.getSentRfqs()) {
            for (const s of rfq.suppliers) {
                if (s.lastReminderAt && new Date(s.lastReminderAt).toDateString() === today) {
                    sentToday++;
                }
            }
        }
        return {
            pendingReminders: pending.length,
            sentToday,
            suppliersWithoutResponse: pending,
        };
    }
};
exports.ReminderService = ReminderService;
__decorate([
    (0, schedule_1.Cron)('0 9,14 * * 1-5'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ReminderService.prototype, "scheduledReminderCheck", null);
exports.ReminderService = ReminderService = ReminderService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        rfq_lifecycle_service_1.RfqLifecycleService,
        webhook_service_1.WebhookService])
], ReminderService);
//# sourceMappingURL=reminder.service.js.map