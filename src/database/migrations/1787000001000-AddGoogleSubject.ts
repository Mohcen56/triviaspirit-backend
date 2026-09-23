import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleSubject1787000001000 implements MigrationInterface {
  name = 'AddGoogleSubject1787000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth_user"
      ADD COLUMN IF NOT EXISTS "google_subject" varchar(255) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "auth_user_google_subject_unique"
      ON "auth_user" ("google_subject")
      WHERE "google_subject" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "auth_user_google_subject_unique"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_user" DROP COLUMN IF EXISTS "google_subject"',
    );
  }
}
