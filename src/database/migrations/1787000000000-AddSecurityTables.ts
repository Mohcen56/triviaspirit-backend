import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecurityTables1787000000000 implements MigrationInterface {
  name = 'AddSecurityTables1787000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_auth_rate_limit" (
        "rate_key" varchar(255) NOT NULL,
        "total_hits" integer NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "blocked_until" timestamptz NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_auth_rate_limit" PRIMARY KEY ("rate_key")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_auth_rate_limit_expires_at"
      ON "security_auth_rate_limit" ("expires_at")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payments_webhook_event" (
        "id" bigserial NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "event_name" varchar(100) NOT NULL,
        "resource_id" varchar(255) NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz NULL,
        CONSTRAINT "UQ_payments_webhook_event_fingerprint" UNIQUE ("fingerprint"),
        CONSTRAINT "PK_payments_webhook_event" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "payments_webhook_event"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_security_auth_rate_limit_expires_at"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "security_auth_rate_limit"');
  }
}
