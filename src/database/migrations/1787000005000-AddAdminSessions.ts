import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminSessionsAndAmounts1787000005000 implements MigrationInterface {
  name = 'AddAdminSessionsAndAmounts1787000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments_payment"
      ADD COLUMN IF NOT EXISTS "amount_minor" integer NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "auth_user"
      ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_admin_session" (
        "session_id" varchar(255) NOT NULL,
        "data" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "PK_security_admin_session" PRIMARY KEY ("session_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_admin_session_expires_at"
      ON "security_admin_session" ("expires_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "payments_payment" DROP COLUMN IF EXISTS "amount_minor"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_user" DROP COLUMN IF EXISTS "session_version"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_security_admin_session_expires_at"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "security_admin_session"');
  }
}
