import { validateEnvironment } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://user:password@localhost/database',
};

describe('validateEnvironment', () => {
  it('normalizes the port and rejects incomplete payment configuration', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        PORT: '8000',
        LEMONSQUEEZY_API_KEY: 'key',
      }),
    ).toThrow('Lemon Squeezy configuration is incomplete');

    expect(validateEnvironment({ ...base, PORT: '8000' }).PORT).toBe(8000);
  });

  it('requires strong production secrets and origins', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        APP_SECRET: 'short',
      }),
    ).toThrow('APP_SECRET must be at least 32 characters');
  });

  it('rejects ambiguous proxy trust settings', () => {
    expect(() =>
      validateEnvironment({ ...base, TRUST_PROXY: 'all-proxies' }),
    ).toThrow('TRUST_PROXY must be true, false, or a non-negative hop count');
    expect(validateEnvironment({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(
      '2',
    );
  });

  it('accepts the Neon-specific database variable as a fallback', () => {
    const environment = validateEnvironment({
      NEON_DATABASE_URL: 'postgresql://user:password@localhost/database',
    });
    expect(environment.DATABASE_URL).toBe(environment.NEON_DATABASE_URL);
  });

  it('accepts the R2 custom domain as the public media URL', () => {
    const environment = validateEnvironment({
      ...base,
      CLOUDFLARE_R2_BUCKET_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      CLOUDFLARE_R2_ACCESS_KEY: 'access-key',
      CLOUDFLARE_R2_SECRET_KEY: 'secret-key',
      CLOUDFLARE_R2_BUCKET: 'media',
      CLOUDFLARE_R2_CUSTOM_DOMAIN: 'https://images.example.com',
    });
    expect(environment.CLOUDFLARE_R2_CUSTOM_DOMAIN).toBe(
      'https://images.example.com',
    );
  });
});
