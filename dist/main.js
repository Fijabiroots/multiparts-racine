"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    app.enableCors();
    app.setGlobalPrefix('api');
    const configService = app.get(config_1.ConfigService);
    const port = configService.get('app.port') || 3000;
    await app.listen(port);
    logger.log(`🚀 Application démarrée sur http://localhost:${port}`);
    logger.log(`📧 Configuration IMAP: ${configService.get('imap.host')}:${configService.get('imap.port')}`);
    logger.log(`📁 Dossier brouillons: ${configService.get('drafts.folder')}`);
    logger.log(`📂 Dossier output: ${configService.get('app.outputDir')}`);
}
bootstrap();
//# sourceMappingURL=main.js.map