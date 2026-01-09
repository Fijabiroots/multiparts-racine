"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RfqLifecycleModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const rfq_lifecycle_service_1 = require("./rfq-lifecycle.service");
const quote_comparison_service_1 = require("./quote-comparison.service");
const reminder_service_1 = require("./reminder.service");
const inbound_scanner_service_1 = require("./inbound-scanner.service");
const rfq_lifecycle_controller_1 = require("./rfq-lifecycle.controller");
let RfqLifecycleModule = class RfqLifecycleModule {
};
exports.RfqLifecycleModule = RfqLifecycleModule;
exports.RfqLifecycleModule = RfqLifecycleModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, schedule_1.ScheduleModule.forRoot()],
        providers: [
            rfq_lifecycle_service_1.RfqLifecycleService,
            quote_comparison_service_1.QuoteComparisonService,
            reminder_service_1.ReminderService,
            inbound_scanner_service_1.InboundScannerService,
        ],
        controllers: [rfq_lifecycle_controller_1.RfqLifecycleController],
        exports: [
            rfq_lifecycle_service_1.RfqLifecycleService,
            quote_comparison_service_1.QuoteComparisonService,
            reminder_service_1.ReminderService,
            inbound_scanner_service_1.InboundScannerService,
        ],
    })
], RfqLifecycleModule);
//# sourceMappingURL=rfq-lifecycle.module.js.map