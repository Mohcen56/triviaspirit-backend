type Environment = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(environment: Environment, name: string): string {
  const value = text(environment[name]);
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function validateBoolean(environment: Environment, name: string) {
  const value = text(environment[name]).toLowerCase();
  if (value && value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false`);
  }
}

function validateTrustProxy(environment: Environment) {
  const value = text(environment.TRUST_PROXY).toLowerCase();
  if (!value || value === 'true' || value === 'false') return;
  if (/^\d+$/.test(value)) return;
  throw new Error(
    'TRUST_PROXY must be true, false, or a non-negative hop count',
  );
}

function validateCompleteIntegration(
  environment: Environment,
  names: string[],
  label: string,
) {
  const configured = names.map((name) => Boolean(text(environment[name])));
  const count = configured.filter(Boolean).length;
  if (count > 0 && count < names.length) {
    throw new Error(`${label} configuration is incomplete`);
  }
}

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnv = text(environment.NODE_ENV) || 'development';
  const port = Number(environment.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  requireText(environment, 'DATABASE_URL');
  for (const name of [
    'DATABASE_SSL',
    'DATABASE_SSL_REJECT_UNAUTHORIZED',
    'DATABASE_SYNCHRONIZE',
    'DATABASE_MIGRATIONS_RUN',
    'DATABASE_LOGGING',
  ]) {
    validateBoolean(environment, name);
  }
  validateTrustProxy(environment);

  validateCompleteIntegration(
    environment,
    [
      'CLOUDFLARE_R2_BUCKET_ENDPOINT',
      'CLOUDFLARE_R2_ACCESS_KEY',
      'CLOUDFLARE_R2_SECRET_KEY',
      'CLOUDFLARE_R2_BUCKET',
      'CLOUDFLARE_R2_PUBLIC_URL',
    ],
    'Cloudflare R2',
  );

  const apiKeyConfigured = Boolean(text(environment.LEMONSQUEEZY_API_KEY));
  const storeConfigured = Boolean(text(environment.LEMONSQUEEZY_STORE_ID));
  const variantConfigured = Boolean(text(environment.LEMONSQUEEZY_VARIANT_ID));
  if ((apiKeyConfigured || storeConfigured) && !variantConfigured) {
    throw new Error('Lemon Squeezy checkout configuration is incomplete');
  }
  if (apiKeyConfigured !== storeConfigured) {
    throw new Error('Lemon Squeezy checkout configuration is incomplete');
  }
  const checkoutConfigured =
    apiKeyConfigured && storeConfigured && variantConfigured;
  if (checkoutConfigured) {
    requireText(environment, 'LEMONSQUEEZY_WEBHOOK_SECRET');
    requireText(environment, 'LEMONSQUEEZY_TEST_MODE');
  }
  validateBoolean(environment, 'LEMONSQUEEZY_TEST_MODE');

  if (nodeEnv === 'production') {
    const appSecret = requireText(environment, 'APP_SECRET');
    if (appSecret.length < 32) {
      throw new Error(
        'APP_SECRET must be at least 32 characters in production',
      );
    }
    const adminSecret = text(environment.ADMIN_COOKIE_SECRET);
    if (adminSecret && adminSecret.length < 32) {
      throw new Error(
        'ADMIN_COOKIE_SECRET must be at least 32 characters in production',
      );
    }
    requireText(environment, 'FRONTEND_URL');
    requireText(environment, 'CORS_ALLOWED_ORIGINS');
  }

  return { ...environment, NODE_ENV: nodeEnv, PORT: port };
}
