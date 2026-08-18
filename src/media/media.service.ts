import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import sharp from 'sharp';

export type StoredImage = { key: string; hash: string };

@Injectable()
export class MediaService {
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('CLOUDFLARE_R2_BUCKET_ENDPOINT');
    const accessKeyId = config.get<string>('CLOUDFLARE_R2_ACCESS_KEY');
    const secretAccessKey = config.get<string>('CLOUDFLARE_R2_SECRET_KEY');
    this.s3 =
      endpoint && accessKeyId && secretAccessKey
        ? new S3Client({
            region: 'auto',
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  async storeImage(
    file: Express.Multer.File,
    folder: 'avatars' | 'categories' | 'questions' | 'answers',
    maxSizeMb = 10,
  ): Promise<StoredImage> {
    if (!file?.buffer)
      throw new BadRequestException({ error: 'No image file provided' });
    if (file.size > maxSizeMb * 1024 * 1024) {
      throw new BadRequestException({
        error: `Image must be ${maxSizeMb}MB or smaller`,
      });
    }
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException({
        error: 'Only JPEG, PNG, GIF, and WebP images are allowed',
      });
    }

    let optimized: Buffer;
    try {
      optimized = await sharp(file.buffer, {
        animated: file.mimetype === 'image/gif',
      })
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException({
        error: 'Failed to process image. Please try a different file.',
      });
    }

    const base = file.originalname
      .replace(extname(file.originalname), '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-');
    const key = `${folder}/${base || 'image'}-${randomUUID()}.webp`;
    const hash = createHash('sha256').update(optimized).digest('hex');
    const bucket = this.config.get<string>('CLOUDFLARE_R2_BUCKET');

    if (this.s3 && bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: optimized,
          ContentType: 'image/webp',
        }),
      );
    } else {
      const root = resolve(
        process.cwd(),
        this.config.get('MEDIA_ROOT', 'media'),
      );
      const destination = resolve(root, key);
      if (!destination.startsWith(root))
        throw new Error('Invalid media destination');
      await mkdir(resolve(destination, '..'), { recursive: true });
      await writeFile(destination, optimized);
    }

    return { key, hash };
  }

  url(value?: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const key = value.replace(/^\/?media\//, '').replace(/^\//, '');
    const base =
      this.config.get<string>('CLOUDFLARE_R2_PUBLIC_URL') ||
      this.config.get<string>('MEDIA_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT', 8000)}/media`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}
