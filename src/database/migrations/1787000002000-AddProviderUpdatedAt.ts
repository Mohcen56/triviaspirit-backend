import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderUpdatedAt1787000002000 implements MigrationInterface {
  name = 'AddProviderUpdatedAt1787000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments_payment"
      ADD COLUMN IF NOT EXISTS "provider_updated_at" timestamptz NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "payments_subscription"
      ADD COLUMN IF NOT EXISTS "provider_updated_at" timestamptz NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "payments_subscription" DROP COLUMN IF EXISTS "provider_updated_at"',
    );
    await queryRunner.query(
      'ALTER TABLE "payments_payment" DROP COLUMN IF EXISTS "provider_updated_at"',
    );
  }
}
