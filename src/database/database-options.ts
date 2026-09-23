import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { ENTITIES } from './entities';

function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

export function databaseOptions(
  environment: NodeJS.ProcessEnv = process.env,
): PostgresConnectionOptions {
  const url = environment.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be configured');
  const production = environment.NODE_ENV === 'production';
  const synchronize = enabled(environment.DATABASE_SYNCHRONIZE);
  const sslEnabled = enabled(environment.DATABASE_SSL);
  if (production && synchronize) {
    throw new Error('DATABASE_SYNCHRONIZE must be false in production');
  }
  if (production && !sslEnabled) {
    throw new Error('DATABASE_SSL must be true in production');
  }
  const rejectUnauthorized =
    environment.DATABASE_SSL_REJECT_UNAUTHORIZED?.toLowerCase() !== 'false';
  if (production && !rejectUnauthorized) {
    throw new Error(
      'DATABASE_SSL_REJECT_UNAUTHORIZED must be true in production',
    );
  }

  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    migrationsRun: enabled(environment.DATABASE_MIGRATIONS_RUN),
    synchronize,
    logging: enabled(environment.DATABASE_LOGGING),
    ssl: sslEnabled ? { rejectUnauthorized } : false,
  };
}
