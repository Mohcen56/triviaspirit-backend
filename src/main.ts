import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { setupAdmin } from './admin/setup-admin';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 8000);
  const origins = config
    .get<string>(
      'CORS_ALLOWED_ORIGINS',
      'http://localhost:3000,http://127.0.0.1:3000',
    )
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useStaticAssets(
    resolve(process.cwd(), config.get<string>('MEDIA_ROOT', 'media')),
    {
      prefix: '/media/',
    },
  );
  await setupAdmin(app);
  app.set('trust proxy', 1);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
