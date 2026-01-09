"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const scheduler_service_1 = require("./scheduler.service");
const auto_processor_service_1 = require("./auto-processor.service");
const scheduler_controller_1 = require("./scheduler.controller");
const email_module_1 = require("../email/email.module");
const detector_module_1 = require("../detector/detector.module");
const parser_module_1 = require("../parser/parser.module");
const excel_module_1 = require("../excel/excel.module");
const draft_module_1 = require("../draft/draft.module");
const mail_module_1 = require("../mail/mail.module");
let SchedulerModule = class SchedulerModule {
};
exports.SchedulerModule = SchedulerModule;
exports.SchedulerModule = SchedulerModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            email_module_1.EmailModule,
            detector_module_1.DetectorModule,
            parser_module_1.ParserModule,
            excel_module_1.ExcelModule,
            draft_module_1.DraftModule,
            mail_module_1.MailModule,
        ],
        providers: [scheduler_service_1.SchedulerService, auto_processor_service_1.AutoProcessorService],
        controllers: [scheduler_controller_1.SchedulerController],
        exports: [scheduler_service_1.SchedulerService, auto_processor_service_1.AutoProcessorService],
    })
], SchedulerModule);
//# sourceMappingURL=scheduler.module.js.map