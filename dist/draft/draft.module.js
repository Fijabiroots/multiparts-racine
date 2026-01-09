"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftModule = void 0;
const common_1 = require("@nestjs/common");
const draft_service_1 = require("./draft.service");
const draft_controller_1 = require("./draft.controller");
let DraftModule = class DraftModule {
};
exports.DraftModule = DraftModule;
exports.DraftModule = DraftModule = __decorate([
    (0, common_1.Module)({
        providers: [draft_service_1.DraftService],
        controllers: [draft_controller_1.DraftController],
        exports: [draft_service_1.DraftService],
    })
], DraftModule);
//# sourceMappingURL=draft.module.js.map