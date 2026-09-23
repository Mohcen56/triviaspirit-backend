import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { resolve } from 'node:path';
import { setupAdmin } from './admin/setup-admin';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.enableShutdownHooks();
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
  app.use((request: Request, response: Response, next: NextFunction): void => {
    const contentType = request.headers['content-type'] || '';
    const contentLength = Number(request.headers['content-length'] || 0);
    if (
      contentType.toLowerCase().startsWith('multipart/form-data') &&
      Number.isSafeInteger(contentLength) &&
      contentLength > 64 * 1024 * 1024
    ) {
      response.status(413).json({ error: 'Multipart request is too large' });
      return;
    }
    next();
  });
  const trustProxyValue = config
    .get<string>('TRUST_PROXY', 'false')
    .trim()
    .toLowerCase();
  const trustProxy =
    trustProxyValue === 'true'
      ? true
      : trustProxyValue === 'false'
        ? false
        : /^\d+$/.test(trustProxyValue)
          ? Number(trustProxyValue)
          : false;
  app.set('trust proxy', trustProxy);
  app.useStaticAssets(
    resolve(process.cwd(), config.get<string>('MEDIA_ROOT', 'media')),
    {
      prefix: '/media/',
    },
  );
  await setupAdmin(app);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
