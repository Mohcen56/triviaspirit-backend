import { databaseOptions } from './database-options';

describe('databaseOptions production safeguards', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:password@localhost/database',
    NODE_ENV: 'production',
    DATABASE_SSL: 'true',
    DATABASE_SYNCHRONIZE: 'false',
  };

  it('rejects production schema synchronization', () => {
    expect(() =>
      databaseOptions({
        ...base,
        DATABASE_SYNCHRONIZE: 'true',
      }),
    ).toThrow('DATABASE_SYNCHRONIZE must be false in production');
  });

  it('requires verified database TLS in production', () => {
    expect(() =>
      databaseOptions({
        ...base,
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
      }),
    ).toThrow('DATABASE_SSL_REJECT_UNAUTHORIZED must be true in production');
  });

  it('enables verified TLS by default', () => {
    const options = databaseOptions(base);
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.synchronize).toBe(false);
  });
});
