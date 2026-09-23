import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { paginated, parsePagination, stringValue } from '../common/utils';
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
import { CreateGameDto, FinishRoundDto } from './dto/gameplay.dto';

@Injectable()
export class GameplayService {
  constructor(
    @InjectRepository(GameEntity)
    private readonly games: Repository<GameEntity>,
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

  async list(
    query: Record<string, string | string[] | undefined>,
    user: UserEntity,
  ) {
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.games.findAndCount({
      where: { playerId: user.id },
      relations: {
        player: { profile: true },
        categoryLinks: { category: true },
        playedQuestions: { question: { category: true } },
      },
      order: { datePlayed: 'DESC' },
      skip: offset,
      take: limit,
    });
    return paginated(
      await Promise.all(
        rows.map((game) => this.serializeGame(game, user, false)),
      ),
      total,
      offset,
      limit,
    );
  }

  async create(user: UserEntity, body: CreateGameDto) {
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
          ...team,
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
    const loaded = await this.loadGame(game.id, user.id);
    await this.ensureBoardSnapshot(loaded);
    return this.serializeGame(loaded, user, false);
  }

  async retrieve(id: number, user: UserEntity) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    return this.serializeGame(game, user, true);
  }

  async remove(id: number, user: UserEntity) {
    const game = await this.games.findOneBy({ id, playerId: user.id });
    if (!game) throw new NotFoundException();
    await this.games.remove(game);
  }

  async finishRound(id: number, user: UserEntity, body: FinishRoundDto) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    await this.ensureBoardSnapshot(game);
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
    const categoryIds = (game.categoryLinks || []).map((link) =>
      Number(link.categoryId),
    );
    const boardIds = new Set(
      (game.boardQuestionIds || []).map((questionId) => Number(questionId)),
    );
    if (ids.some((questionId) => !boardIds.has(questionId))) {
      throw new BadRequestException({
        error: 'Every played question must belong to this game board',
      });
    }
    const questions = await this.questions.findBy({
      id: In(ids),
      categoryId: In(categoryIds),
    });
    if (questions.length !== ids.length) {
      throw new BadRequestException({
        error: 'Every played question must belong to this game',
      });
    }
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
    if (!additions.length) return { status: 'ok', saved: 0 };
    const result = await this.played
      .createQueryBuilder()
      .insert()
      .into(PlayedQuestionEntity)
      .values(
        additions.map(({ gameId, questionId }) => ({ gameId, questionId })),
      )
      .orIgnore()
      .returning(['id'])
      .execute();
    return { status: 'ok', saved: result.identifiers.length };
  }

  async availableQuestions(id: number, user: UserEntity) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    await this.ensureBoardSnapshot(game);
    return (await this.getAvailableQuestions(game)).map((question) =>
      this.content.serializeQuestion(question),
    );
  }

  async outsideBoard(id: number, user: UserEntity, rawCount?: number) {
    const game = await this.loadGame(id, user.id);
    this.assertGameAccess(game, user);
    const countValue = rawCount ?? 4;
    const count = Number.isFinite(countValue)
      ? Math.max(1, Math.min(Math.trunc(countValue), 10))
      : 4;
    const available = await this.getAvailableQuestions(game);
    return (await this.getOutsideBoardQuestions(game, count, available)).map(
      (question) => this.content.serializeQuestion(question),
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
        ...this.content.categorySummary(category),
        image_url: this.media.url(category.image),
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
      categories: await this.content.serializeCategories(categories, user),
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
        await this.getOutsideBoardQuestions(game, 4, available)
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
    await this.ensureBoardSnapshot(game);
    const boardIds = game.boardQuestionIds || [];
    if (!boardIds.length) return [];
    const questions = await this.questions.find({
      where: { id: In(boardIds) },
      relations: { category: true },
    });
    const byId = new Map(
      questions.map((question) => [Number(question.id), question]),
    );
    const currentPlayed = new Set(
      (game.playedQuestions || []).map((item) => Number(item.questionId)),
    );
    return boardIds
      .map((questionId) => byId.get(Number(questionId)))
      .filter(
        (question): question is QuestionEntity =>
          question !== undefined && !currentPlayed.has(Number(question.id)),
      );
  }

  private async ensureBoardSnapshot(game: GameEntity): Promise<void> {
    if (game.boardQuestionIds !== null) return;
    const selected = await this.selectBoardQuestions(game);
    const boardIds = [
      ...new Set([
        ...(game.playedQuestions || []).map((item) => Number(item.questionId)),
        ...selected.map((question) => Number(question.id)),
      ]),
    ];
    await this.games.manager.transaction(async (manager) => {
      const current = await manager.findOne(GameEntity, {
        where: { id: game.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw new NotFoundException();
      if (current.boardQuestionIds === null) {
        current.boardQuestionIds = boardIds;
        await manager.save(GameEntity, current);
      }
      game.boardQuestionIds = current.boardQuestionIds;
    });
  }

  private async selectBoardQuestions(
    game: GameEntity,
  ): Promise<QuestionEntity[]> {
    const categoryIds = (game.categoryLinks || []).map((link) =>
      Number(link.categoryId),
    );
    if (!categoryIds.length) return [];
    const currentPlayed = new Set(
      (game.playedQuestions || []).map((item) => Number(item.questionId)),
    );
    const history = await this.played
      .createQueryBuilder('played')
      .innerJoin(GameEntity, 'game', 'game.id = played.game_id')
      .innerJoin(QuestionEntity, 'question', 'question.id = played.question_id')
      .where('game.player_id = :playerId', { playerId: game.playerId })
      .andWhere('question.category_id IN (:...categoryIds)', { categoryIds })
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
    available: QuestionEntity[],
  ): Promise<QuestionEntity[]> {
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
