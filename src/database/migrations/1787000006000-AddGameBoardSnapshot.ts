import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGameBoardSnapshot1787000006000 implements MigrationInterface {
  name = 'AddGameBoardSnapshot1787000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gameplay_game"
      ADD COLUMN IF NOT EXISTS "board_question_ids" jsonb NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "gameplay_game" DROP COLUMN IF EXISTS "board_question_ids"',
    );
  }
}
