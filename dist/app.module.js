"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const serve_static_1 = require("@nestjs/serve-static");
const path_1 = require("path");
const configuration_1 = require("./config/configuration");
const database_module_1 = require("./database/database.module");
const email_module_1 = require("./email/email.module");
const pdf_module_1 = require("./pdf/pdf.module");
const excel_module_1 = require("./excel/excel.module");
const draft_module_1 = require("./draft/draft.module");
const parser_module_1 = require("./parser/parser.module");
const detector_module_1 = require("./detector/detector.module");
const scheduler_module_1 = require("./scheduler/scheduler.module");
const price_request_module_1 = require("./price-request/price-request.module");
const review_module_1 = require("./review/review.module");
const acknowledgment_module_1 = require("./acknowledgment/acknowledgment.module");
const tracking_module_1 = require("./tracking/tracking.module");
const webhook_module_1 = require("./webhook/webhook.module");
const rfq_lifecycle_module_1 = require("./rfq-lifecycle/rfq-lifecycle.module");
const brand_intelligence_module_1 = require("./brand-intelligence/brand-intelligence.module");
const app_controller_1 = require("./app.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                envFilePath: ['.env.local', '.env'],
            }),
            serve_static_1.ServeStaticModule.forRoot({
                rootPath: (0, path_1.join)(__dirname, '..', 'public'),
                serveRoot: '/',
            }),
            webhook_module_1.WebhookModule,
            brand_intelligence_module_1.BrandIntelligenceModule,
            database_module_1.DatabaseModule,
            email_module_1.EmailModule,
            pdf_module_1.PdfModule,
            excel_module_1.ExcelModule,
            draft_module_1.DraftModule,
            parser_module_1.ParserModule,
            detector_module_1.DetectorModule,
            scheduler_module_1.SchedulerModule,
            price_request_module_1.PriceRequestModule,
            review_module_1.ReviewModule,
            acknowledgment_module_1.AcknowledgmentModule,
            tracking_module_1.TrackingModule,
            rfq_lifecycle_module_1.RfqLifecycleModule,
        ],
        controllers: [app_controller_1.AppController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map