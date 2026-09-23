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
});
