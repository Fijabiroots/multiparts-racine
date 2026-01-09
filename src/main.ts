import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Validation globale des DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS pour le développement
  app.enableCors();

  // Préfixe API
  app.setGlobalPrefix('api');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 3000;

  await app.listen(port);

  logger.log(`🚀 Application démarrée sur http://localhost:${port}`);
  logger.log(`📧 Configuration IMAP: ${configService.get<string>('imap.host')}:${configService.get<number>('imap.port')}`);
  logger.log(`📁 Dossier brouillons: ${configService.get<string>('drafts.folder')}`);
  logger.log(`📂 Dossier output: ${configService.get<string>('app.outputDir')}`);
}

bootstrap();
