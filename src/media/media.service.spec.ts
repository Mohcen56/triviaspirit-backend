import type { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn(
      (name: string, fallback?: unknown) => values[name] ?? fallback,
    ),
  } as unknown as ConfigService;
}

describe('MediaService', () => {
  it('uses the shared Django media prefix for R2 URLs', () => {
    const service = new MediaService(
      config({
        CLOUDFLARE_R2_BUCKET_ENDPOINT:
          'https://account.r2.cloudflarestorage.com',
        CLOUDFLARE_R2_ACCESS_KEY: 'access-key',
        CLOUDFLARE_R2_SECRET_KEY: 'secret-key',
        CLOUDFLARE_R2_BUCKET: 'questions-bucket',
        CLOUDFLARE_R2_CUSTOM_DOMAIN: 'https://cdn.example.com',
      }),
    );

    expect(service.url('questions/example.webp')).toBe(
      'https://cdn.example.com/media/questions/example.webp',
    );
    expect(service.url('media/questions/example.webp')).toBe(
      'https://cdn.example.com/media/questions/example.webp',
    );
  });

  it('keeps local media URLs unchanged when R2 is disabled', () => {
    const service = new MediaService(
      config({
        MEDIA_PUBLIC_URL: 'http://localhost:8000/media',
      }),
    );

    expect(service.url('questions/example.webp')).toBe(
      'http://localhost:8000/media/questions/example.webp',
    );
  });
});
