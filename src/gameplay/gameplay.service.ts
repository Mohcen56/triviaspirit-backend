import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { paginated, stringValue } from '../common/utils';
import { ContentService } from '../content/content.service';
import {
  CategoryEntity,
  GameCategoryEntity,
  GameEntity,
  PlayedQuestionEntity,
  QuestionEntity,
  UserEntity,
} from '../database/entities';
import { MediaService } from '../media/media.service';

@Injectable()
export class GameplayService {
  constructor(
    @InjectRepository(GameEntity)
    private readonly games: Repository<GameEntity>,
    @InjectRepository(GameCategoryEntity)
    private readonly gameCategories: Repository<GameCategoryEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(QuestionEntity)
    private readonly questions: Repository<QuestionEntity>,
    @InjectRepository(PlayedQuestionEntity)
    private readonly played: Repository<PlayedQuestionEntity>,
    private readonly content: ContentService,
    private readonly auth: AuthService,
    private readonly media: MediaService,
  ) {}

  async list(user: UserEntity) {
    const rows = await this.games.find({
      where: { playerId: user.id },
      relations: {
        player: { profile: true },
        categoryLinks: { category: true },
        playedQuestions: { question: { category: true } },
      },
      order: { datePlayed: 'DESC' },
    });
    return paginated(
      await Promise.all(
        rows.map((game) => this.serializeGame(game, user, false)),
      ),
    );
  }

  async create(user: UserEntity, body: Record<string, unknown>) {
    const rawCategoryIds = body.category_ids;
    if (!Array.isArray(rawCategoryIds) || !rawCategoryIds.length) {
      throw new BadRequestException({
        category_ids: ['This field is required.'],
      });
    }
    const categoryIds = [
      ...new Set(rawCategoryIds.map((value) => Number(value))),
    ];
    if (categoryIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException({
        category_ids: ['Category IDs must be integers.'],
      });
    }
    const categories = await this.categories.findBy({ id: In(categoryIds) });
    const found = new Set(categories.map((category) => Number(category.id)));
    const missing = categoryIds.filter((id) => !found.has(id));
    if (missing.length)
      throw new BadRequestException({
        category_ids: `Unknown category ID(s): ${missing.join(', ')}`,
      });
    if (
      categories.some(
        (category) => !this.content.canAccessCategory(user, category),
      )
    ) {
      throw new BadRequestException({
        category_ids: [
          'You do not have access to one or more selected categories.',
        ],
      });
    }
    const mode = stringValue(body.mode, 'offline');
    if (!['offline', 'solo', 'online'].includes(mode)) {
      throw new BadRequestException({ mode: ['Invalid mode.'] });
    }
    const rawTeams = Array.isArray(body.teams) ? body.teams : [];
    const teamNames = Array.isArray(body.team_names) ? body.team_names : [];
    const teams = rawTeams.length
      ? rawTeams.map((team, index) => ({
          ...(team as Record<string, unknown>),
          id: index + 1,
        }))
      : teamNames.map((name, index) => ({
          id: index + 1,
          name: String(name),
          avatar: 'cat',
        }));

    const game = await this.games.manager.transaction(async (manager) => {
      const created = await manager.save(
        GameEntity,
        manager.create(GameEntity, {
          playerId: user.id,
          mode: mode as GameEntity['mode'],
          teams,
        }),
      );
      await manager.save(
        GameCategoryEntity,
        categoryIds.map((categoryId) =>
          manager.create(GameCategoryEntity, {
            gameId: created.id,
            categoryId,
          }),
        ),
      );
      return created;
    });
    return this.serializeGame(
      await this.loadGame(game.id, user.id),
      user,
      false,
    );
  }

  async retrieve(id: number, user: UserEntity) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    return this.serializeGame(game, user, true);
  }

  async remove(id: number, user: UserEntity) {
    const game = await this.loadGame(id, user.id);
    await this.games.remove(game);
  }

  async finishRound(
    id: number,
    user: UserEntity,
    body: Record<string, unknown>,
  ) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    if (!Array.isArray(body.played_question_ids)) {
      throw new BadRequestException({
        error: 'played_question_ids must be a list',
      });
    }
    const ids = [
      ...new Set(body.played_question_ids.map((value) => Number(value))),
    ];
    if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new BadRequestException({
        error: 'played_question_ids must contain integers',
      });
    }
    if (!ids.length) return { status: 'ok', saved: 0 };
    const questions = await this.questions.findBy({ id: In(ids) });
    const existing = await this.played.findBy({
      gameId: id,
      questionId: In(questions.map((item) => item.id)),
    });
    const existingIds = new Set(
      existing.map((item) => Number(item.questionId)),
    );
    const additions = questions
      .filter((item) => !existingIds.has(Number(item.id)))
      .map((item) => this.played.create({ gameId: id, questionId: item.id }));
    if (additions.length) await this.played.save(additions);
    return { status: 'ok', saved: additions.length };
  }

  async availableQuestions(id: number, user: UserEntity) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    return (await this.getAvailableQuestions(game)).map((question) =>
      this.content.serializeQuestion(question),
    );
  }

  async outsideBoard(id: number, user: UserEntity, rawCount?: string) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    const countValue = Number(rawCount || 4);
    const count = Number.isFinite(countValue)
      ? Math.max(1, Math.min(Math.trunc(countValue), 10))
      : 4;
    return (await this.getOutsideBoardQuestions(game, count)).map((question) =>
      this.content.serializeQuestion(question),
    );
  }

  async stats(user: UserEntity) {
    const totalGames = await this.games.countBy({ playerId: user.id });
    const answered = await this.played
      .createQueryBuilder('played')
      .innerJoin(GameEntity, 'game', 'game.id = played.game_id')
      .where('game.player_id = :userId', { userId: user.id })
      .getCount();
    return { total_games: totalGames, total_questions_answered: answered };
  }

  async recent(user: UserEntity) {
    const games = await this.games.find({
      where: { playerId: user.id },
      relations: { categoryLinks: { category: true } },
      order: { datePlayed: 'DESC' },
      take: 3,
    });
    return games.map((game) => ({
      id: Number(game.id),
      mode: game.mode,
      date_played: game.datePlayed.toISOString(),
      categories: (game.categoryLinks || []).map(({ category }) => ({
        id: Number(category.id),
        name: category.name,
        description: category.description,
        image_url: this.media.url(category.image),
        is_premium: category.locked,
      })),
    }));
  }

  private async serializeGame(
    game: GameEntity,
    user: UserEntity,
    lightweight: boolean,
  ) {
    const categories = (game.categoryLinks || []).map((link) => link.category);
    const base: Record<string, unknown> = {
      id: Number(game.id),
      player: this.auth.serializeUser(game.player || user),
      mode: game.mode,
      categories: await Promise.all(
        categories.map((category) =>
          this.content.serializeCategory(category, user),
        ),
      ),
      teams: (game.teams || []).map((team, index) => ({
        ...team,
        id: team.id ?? index + 1,
      })),
      date_played: game.datePlayed,
    };
    if (lightweight) {
      const available = await this.getAvailableQuestions(game);
      base.available_questions = available.map((question) =>
        this.content.serializeQuestion(question),
      );
      base.outside_board_questions = (
        await this.getOutsideBoardQuestions(game, 4)
      ).map((question) => this.content.serializeQuestion(question));
    } else {
      base.played_questions = (game.playedQuestions || [])
        .filter((item) =>
          this.content.canAccessCategory(user, item.question.category),
        )
        .map((item) => ({
          id: Number(item.id),
          question: this.content.serializeQuestion(item.question),
        }));
    }
    return base;
  }

  private async getAvailableQuestions(
    game: GameEntity,
  ): Promise<QuestionEntity[]> {
    const currentPlayed = new Set(
      (game.playedQuestions || []).map((item) => Number(item.questionId)),
    );
    const history = await this.played
      .createQueryBuilder('played')
      .innerJoin(GameEntity, 'game', 'game.id = played.game_id')
      .where('game.player_id = :playerId', { playerId: game.playerId })
      .select('played.question_id', 'question_id')
      .addSelect('played.game_id', 'game_id')
      .addSelect('game.date_played', 'date_played')
      .getRawMany<{
        question_id: string;
        game_id: string;
        date_played: Date;
      }>();
    const exclusion = new Set(
      history
        .filter((row) =>
          currentPlayed.size
            ? new Date(row.date_played).getTime() < game.datePlayed.getTime()
            : Number(row.game_id) !== Number(game.id),
        )
        .map((row) => Number(row.question_id)),
    );

    const selected: QuestionEntity[] = [];
    for (const link of game.categoryLinks || []) {
      const builder = this.questions
        .createQueryBuilder('question')
        .leftJoinAndSelect('question.category', 'category')
        .where('question.category_id = :categoryId', {
          categoryId: link.categoryId,
        })
        .orderBy('question.random_key', 'ASC');
      if (exclusion.size)
        builder.andWhere('question.id NOT IN (:...exclusion)', {
          exclusion: [...exclusion],
        });
      const pool = await builder.getMany();
      const easy = pool.filter((item) => item.difficulty === '200');
      const medium = pool.filter((item) => item.difficulty === '400');
      const hard = pool.filter((item) => item.difficulty === '600');
      const categorySelection = [
        ...easy.slice(0, 2),
        ...medium.slice(0, 2),
        ...hard.slice(0, 2),
      ];
      if (categorySelection.length < 6) {
        categorySelection.push(
          ...[...easy.slice(2), ...medium.slice(2), ...hard.slice(2)].slice(
            0,
            6 - categorySelection.length,
          ),
        );
      }
      selected.push(...categorySelection);
    }
    return selected.filter(
      (question) => !currentPlayed.has(Number(question.id)),
    );
  }

  private async getOutsideBoardQuestions(
    game: GameEntity,
    count: number,
  ): Promise<QuestionEntity[]> {
    const available = await this.getAvailableQuestions(game);
    const excluded = new Set([
      ...available.map((item) => Number(item.id)),
      ...(game.playedQuestions || []).map((item) => Number(item.questionId)),
    ]);
    const categoryIds = (game.categoryLinks || []).map((item) =>
      Number(item.categoryId),
    );
    if (!categoryIds.length) return [];
    const builder = this.questions
      .createQueryBuilder('question')
      .leftJoinAndSelect('question.category', 'category')
      .where('question.category_id IN (:...categoryIds)', { categoryIds })
      .orderBy('RANDOM()')
      .take(count);
    if (excluded.size)
      builder.andWhere('question.id NOT IN (:...excluded)', {
        excluded: [...excluded],
      });
    return builder.getMany();
  }

  private assertGameAccess(game: GameEntity, user: UserEntity) {
    if (
      (game.categoryLinks || []).some(
        (link) => !this.content.canAccessCategory(user, link.category),
      )
    ) {
      throw new ForbiddenException({
        detail:
          'You do not have access to one or more categories in this game.',
      });
    }
  }

  private async loadGame(id: number, playerId: number): Promise<GameEntity> {
    const game = await this.games.findOne({
      where: { id, playerId },
      relations: {
        player: { profile: true },
        categoryLinks: { category: true },
        playedQuestions: { question: { category: true } },
      },
    });
    if (!game) throw new NotFoundException();
    return game;
  }
}
