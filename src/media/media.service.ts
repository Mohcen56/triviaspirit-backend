import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import sharp from 'sharp';

export type StoredImage = { key: string; hash: string };

const R2_MEDIA_PREFIX = 'media';

@Injectable()
export class MediaService {
  private readonly s3: S3Client | null;
  private readonly r2PublicUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('CLOUDFLARE_R2_BUCKET_ENDPOINT');
    const accessKeyId = config.get<string>('CLOUDFLARE_R2_ACCESS_KEY');
    const secretAccessKey = config.get<string>('CLOUDFLARE_R2_SECRET_KEY');
    const bucket = config.get<string>('CLOUDFLARE_R2_BUCKET');
    const publicUrl =
      config.get<string>('CLOUDFLARE_R2_CUSTOM_DOMAIN') ||
      config.get<string>('CLOUDFLARE_R2_PUBLIC_URL');
    this.r2PublicUrl = publicUrl?.replace(/\/$/, '') || null;
    const r2Configuration = [
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicUrl,
    ];
    const configuredCount = r2Configuration.filter(Boolean).length;
    if (configuredCount > 0 && configuredCount < r2Configuration.length) {
      throw new Error(
        'Cloudflare R2 configuration must include endpoint, bucket, access key, secret key, and public URL',
      );
    }
    this.s3 =
      endpoint && accessKeyId && secretAccessKey && bucket
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
    const input =
      file?.buffer ?? (file?.path ? await readFile(file.path) : null);
    if (!input)
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
      optimized = await sharp(input, {
        animated: file.mimetype === 'image/gif',
        limitInputPixels: 16_777_216,
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

    const key = `${folder}/${randomUUID()}.webp`;
    const hash = createHash('sha256').update(optimized).digest('hex');
    const bucket = this.config.get<string>('CLOUDFLARE_R2_BUCKET');

    if (this.s3 && bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: this.r2ObjectKey(key),
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
      if (destination !== root && !destination.startsWith(`${root}${sep}`))
        throw new Error('Invalid media destination');
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, optimized);
    }

    return { key, hash };
  }

  async removeImages(keys: Iterable<string>): Promise<void> {
    const uniqueKeys = [...new Set(keys)].filter(Boolean);
    if (!uniqueKeys.length) return;
    const bucket = this.config.get<string>('CLOUDFLARE_R2_BUCKET');
    if (this.s3 && bucket) {
      await Promise.all(
        uniqueKeys.map((key) =>
          this.s3!.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: this.r2ObjectKey(key),
            }),
          ),
        ),
      );
      return;
    }
    const root = resolve(process.cwd(), this.config.get('MEDIA_ROOT', 'media'));
    await Promise.all(
      uniqueKeys.map(async (key) => {
        const destination = resolve(root, key);
        if (destination === root || !destination.startsWith(`${root}${sep}`)) {
          return;
        }
        try {
          await unlink(destination);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') throw error;
        }
      }),
    );
  }

  url(value?: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const key = value.replace(/^\/?media\//, '').replace(/^\//, '');
    const base =
      this.r2PublicUrl ||
      this.config.get<string>('MEDIA_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT', 8000)}/media`;
    const objectKey = this.s3 ? this.r2ObjectKey(key) : key;
    return `${base.replace(/\/$/, '')}/${objectKey}`;
  }

  private r2ObjectKey(value: string): string {
    const key = value.replace(/^\/?media\//, '').replace(/^\//, '');
    return `${R2_MEDIA_PREFIX}/${key}`;
  }
}
