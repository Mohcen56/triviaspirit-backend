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

  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    migrationsRun: enabled(environment.DATABASE_MIGRATIONS_RUN),
    synchronize: enabled(environment.DATABASE_SYNCHRONIZE),
    logging: enabled(environment.DATABASE_LOGGING),
    ssl: enabled(environment.DATABASE_SSL)
      ? { rejectUnauthorized: false }
      : false,
  };
}
