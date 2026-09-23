import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCaseInsensitiveEmailUniqueIndex1787000003000 implements MigrationInterface {
  name = 'AddCaseInsensitiveEmailUniqueIndex1787000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "auth_user"
          WHERE btrim("email") <> ''
          GROUP BY lower(btrim("email"))
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION
            'Cannot create auth_user email uniqueness index: duplicate normalized emails exist';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "auth_user_email_ci_unique"
      ON "auth_user" (lower(btrim("email")))
      WHERE btrim("email") <> ''
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "auth_user_email_ci_unique"');
  }
}
