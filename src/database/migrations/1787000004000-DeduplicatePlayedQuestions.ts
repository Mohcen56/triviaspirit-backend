import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeduplicatePlayedQuestions1787000004000 implements MigrationInterface {
  name = 'DeduplicatePlayedQuestions1787000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "gameplay_playedquestion" duplicate
      USING "gameplay_playedquestion" keeper
      WHERE duplicate."game_id" = keeper."game_id"
        AND duplicate."question_id" = keeper."question_id"
        AND duplicate."id" > keeper."id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_playedquestion_game_question_unique"
      ON "gameplay_playedquestion" ("game_id", "question_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "gameplay_playedquestion_game_question_unique"',
    );
  }
}
