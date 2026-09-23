import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import {
  integerId,
  paginated,
  parsePagination,
  stringValue,
} from '../common/utils';
import {
  CategoryEntity,
  CategoryLikeEntity,
  CollectionEntity,
  GameEntity,
  PlayedQuestionEntity,
  QuestionEntity,
  SavedCategoryEntity,
  UserEntity,
} from '../database/entities';
import { MediaService } from '../media/media.service';
import {
  AddQuestionsDto,
  CategoryPrivacy,
  CreateCategoryDto,
  CreateQuestionDto,
  CreateQuestionInputDto,
  UpdateCategoryDto,
  UpdateQuestionDto,
} from './dto/content.dto';
import {
  collectIndexedQuestionFields,
  parseQuestionJson,
} from './question-input';

type UploadMap = Map<string, Express.Multer.File>;
type UploadInput =
  Express.Multer.File[] | Record<string, Express.Multer.File[]>;

type UserCategoryStats = {
  questionsCount: number;
  playedCount: number;
  savesCount: number;
  likesCount: number;
  saved: Set<number>;
  liked: Set<number>;
};

type CategoryStats = {
  questionsCount: number;
  playedCount: number;
};

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(CollectionEntity)
    private readonly collections: Repository<CollectionEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(QuestionEntity)
    private readonly questions: Repository<QuestionEntity>,
    @InjectRepository(SavedCategoryEntity)
    private readonly saved: Repository<SavedCategoryEntity>,
    @InjectRepository(CategoryLikeEntity)
    private readonly likes: Repository<CategoryLikeEntity>,
    @InjectRepository(PlayedQuestionEntity)
    private readonly played: Repository<PlayedQuestionEntity>,
    private readonly media: MediaService,
  ) {}

  canAccessCategory(
    user: UserEntity | undefined,
    category: CategoryEntity,
  ): boolean {
    if (!this.canDiscoverCategory(user, category)) return false;
    if (
      category.isCustom &&
      !user?.isStaff &&
      category.createdById !== user?.id &&
      (!category.isApproved || category.privacy !== 'public')
    ) {
      return false;
    }
    if (!category.locked) return true;
    if (!user?.profile?.isPremium) return false;
    const expiry = user.profile.premiumExpiry;
    return !expiry || expiry >= new Date().toISOString().slice(0, 10);
  }

  private canDiscoverCategory(
    user: UserEntity | undefined,
    category: CategoryEntity,
  ): boolean {
    if (
      category.isHidden &&
      !user?.isStaff &&
      category.createdById !== user?.id
    ) {
      return false;
    }
    if (!category.isCustom) return true;
    return Boolean(
      user?.isStaff ||
      category.createdById === user?.id ||
      (category.isApproved && category.privacy === 'public'),
    );
  }

  async listCollections(
    query: Record<string, string | string[] | undefined>,
    user?: UserEntity,
  ) {
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.collections.findAndCount({
      order: { order: 'ASC', name: 'ASC' },
      skip: offset,
      take: limit,
    });
    const categories = rows.length
      ? (
          await this.categories.find({
            where: {
              collectionId: In(rows.map((collection) => collection.id)),
            },
            relations: { createdBy: { profile: true } },
          })
        ).filter((category) => this.canDiscoverCategory(user, category))
      : [];
    const serialized = await this.serializeCategories(categories, user);
    const serializedById = new Map(
      serialized.map((item, index) => [Number(categories[index].id), item]),
    );
    return paginated(
      rows.map((collection) => {
        const collectionCategories = categories
          .filter(
            (category) =>
              Number(category.collectionId) === Number(collection.id),
          )
          .map((category) => serializedById.get(Number(category.id)));
        return {
          id: Number(collection.id),
          name: collection.name,
          order: collection.order,
          categories: collectionCategories,
          categories_count: collectionCategories.length,
        };
      }),
      total,
      offset,
      limit,
    );
  }

  async getCollection(id: number, user?: UserEntity) {
    const collection = await this.collections.findOneBy({ id });
    if (!collection) throw new NotFoundException();
    const categories = (
      await this.categories.find({
        where: { collectionId: id },
        relations: { createdBy: { profile: true } },
      })
    ).filter((category) => this.canDiscoverCategory(user, category));
    return {
      id: Number(collection.id),
      name: collection.name,
      order: collection.order,
      categories: await this.serializeCategories(categories, user),
      categories_count: categories.length,
    };
  }

  async collectionsWithCategories(user?: UserEntity) {
    const collections = await this.collections.find({
      order: { order: 'ASC', name: 'ASC' },
    });
    const official = await this.loadOfficialCategories();
    return this.serializeCollectionsWithCategories(collections, official, user);
  }

  private async loadOfficialCategories() {
    return this.categories.find({
      where: { isCustom: false, isHidden: false },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
    });
  }

  private async serializeCollectionsWithCategories(
    collections: CollectionEntity[],
    official: CategoryEntity[],
    user?: UserEntity,
  ) {
    const serialized = await this.serializeCategories(official, user);
    const serializedById = new Map(
      serialized.map((item, index) => [Number(official[index].id), item]),
    );
    const output: Array<Record<string, unknown>> = [];
    for (const collection of collections) {
      const items = official.filter(
        (category) => Number(category.collectionId) === Number(collection.id),
      );
      if (!items.length) continue;
      output.push({
        id: Number(collection.id),
        name: collection.name,
        order: collection.order,
        categories: items.map((item) => serializedById.get(Number(item.id))),
        categories_count: items.length,
      });
    }
    const uncategorized = official.filter(
      (category) => category.collectionId === null,
    );
    if (uncategorized.length) {
      output.push({
        id: -1,
        name: 'Other Categories',
        order: 999,
        categories: uncategorized.map((item) =>
          serializedById.get(Number(item.id)),
        ),
        categories_count: uncategorized.length,
      });
    }
    return output.sort((a, b) => Number(a.order) - Number(b.order));
  }

  async allCategoryData(user?: UserEntity) {
    const [collectionRows, official] = await Promise.all([
      this.collections.find({ order: { order: 'ASC', name: 'ASC' } }),
      this.loadOfficialCategories(),
    ]);
    const collections = await this.serializeCollectionsWithCategories(
      collectionRows,
      official,
      user,
    );
    const fallback = official.filter(
      (category) => category.collectionId === null,
    );
    const savedCategories = user ? await this.visibleSavedCategories(user) : [];
    const savedStats = user
      ? await this.loadUserCategoryStats(savedCategories, user.id)
      : undefined;
    return {
      collections: collections.filter((item) => item.id !== -1),
      saved_categories: await Promise.all(
        savedCategories.map((item) =>
          this.serializeUserCategory(item, user!, savedStats),
        ),
      ),
      fallback_categories: await this.serializeCategories(fallback, user),
    };
  }

  async listOfficialCategories(
    query: Record<string, string | string[] | undefined>,
    user?: UserEntity,
  ) {
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.categories.findAndCount({
      where: { isCustom: false, isHidden: false },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    return paginated(
      await this.serializeCategories(rows, user),
      total,
      offset,
      limit,
    );
  }

  async getOfficialCategory(id: number, user?: UserEntity) {
    const category = await this.categories.findOne({
      where: { id, isCustom: false, isHidden: false },
      relations: { createdBy: { profile: true } },
    });
    if (!category) throw new NotFoundException();
    this.assertCategoryAccess(user, category);
    return this.serializeCategory(category, user);
  }

  async listQuestions(
    query: Record<string, string | string[] | undefined>,
    user?: UserEntity,
  ) {
    const keys = Object.keys(query);
    if (!keys.length || !query.category_id) {
      throw new MethodNotAllowedException(
        'Listing all questions without category_id is disabled.',
      );
    }
    const unknown = keys.filter(
      (key) => !['category_id', 'limit', 'offset'].includes(key),
    );
    if (unknown.length) {
      throw new BadRequestException({
        detail: `Unknown query parameter(s): ${unknown.join(', ')}. Only 'category_id', 'limit', and 'offset' are permitted.`,
      });
    }
    const categoryId = integerId(
      Array.isArray(query.category_id)
        ? query.category_id[0]
        : query.category_id,
      'category_id',
    );
    const category = await this.categories.findOneBy({ id: categoryId });
    if (!category)
      throw new BadRequestException({
        category_id: 'Category does not exist.',
      });
    this.assertCategoryAccess(user, category);
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.questions.findAndCount({
      where: { categoryId },
      relations: { category: true },
      skip: offset,
      take: limit,
    });
    return paginated(
      rows.map((item) => this.serializeQuestion(item)),
      total,
      offset,
      limit,
    );
  }

  async randomQuestions(
    query: Record<string, string | string[] | undefined>,
    user?: UserEntity,
  ) {
    const rawIds = this.queryArray(query.category_ids);
    if (!rawIds.length)
      throw new BadRequestException({
        error: 'category_ids parameter is required',
      });
    const categoryIds = [
      ...new Set(rawIds.map((id) => integerId(id, 'category_ids'))),
    ];
    const categories = await this.categories.findBy({ id: In(categoryIds) });
    if (categories.length !== categoryIds.length) {
      const found = new Set(categories.map((category) => Number(category.id)));
      throw new BadRequestException({
        category_ids: `Unknown category ID(s): ${categoryIds
          .filter((id) => !found.has(id))
          .join(', ')}`,
      });
    }
    categories.forEach((category) => this.assertCategoryAccess(user, category));
    const count = query.count
      ? Number(Array.isArray(query.count) ? query.count[0] : query.count)
      : 10;
    const offset = query.offset
      ? Number(Array.isArray(query.offset) ? query.offset[0] : query.offset)
      : 0;
    const direction = String(query.direction || 'asc').toLowerCase();
    if (!Number.isInteger(count) || count < 1 || count > 50)
      throw new BadRequestException({
        count: 'count must be between 1 and 50',
      });
    if (!Number.isInteger(offset) || offset < 0)
      throw new BadRequestException({ offset: 'offset must be >= 0' });
    if (!['asc', 'desc'].includes(direction))
      throw new BadRequestException({ direction: "Must be 'asc' or 'desc'" });
    const excluded = this.queryArray(query.exclude_ids).map((id) =>
      integerId(id, 'exclude_ids'),
    );
    const builder = this.questions
      .createQueryBuilder('question')
      .leftJoinAndSelect('question.category', 'category')
      .where('question.category_id IN (:...categoryIds)', { categoryIds })
      .orderBy('question.random_key', direction.toUpperCase() as 'ASC' | 'DESC')
      .skip(offset)
      .take(count);
    if (excluded.length)
      builder.andWhere('question.id NOT IN (:...excluded)', { excluded });
    return (await builder.getMany()).map((item) =>
      this.serializeQuestion(item),
    );
  }

  async getQuestion(id: number, user?: UserEntity) {
    const question = await this.questions.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!question) throw new NotFoundException();
    this.assertCategoryAccess(user, question.category);
    return this.serializeQuestion(question);
  }

  async createQuestion(
    user: UserEntity,
    body: CreateQuestionDto,
    files: UploadInput,
  ) {
    const categoryId = integerId(
      stringValue(body.category_id ?? body.category),
      'category',
    );
    const category = await this.categories.findOneBy({ id: categoryId });
    if (!category)
      throw new BadRequestException({ category: 'Category does not exist.' });
    this.assertCanEditCategory(user, category);
    const question = this.questions.create({ categoryId });
    const uploadedKeys: string[] = [];
    try {
      await this.applyQuestionInput(
        question,
        body,
        this.fileMap(files),
        false,
        uploadedKeys,
      );
      await this.questions.manager.transaction(async (manager) => {
        await manager.getRepository(QuestionEntity).save(question);
        if (!user.isStaff && category.isApproved) {
          category.isApproved = false;
          await manager.getRepository(CategoryEntity).save(category);
        }
      });
    } catch (error) {
      await this.removeImagesBestEffort(uploadedKeys);
      throw error;
    }
    question.category = category;
    return this.serializeQuestion(question);
  }

  async updateQuestion(
    id: number,
    user: UserEntity,
    body: UpdateQuestionDto,
    files: UploadInput,
  ) {
    const question = await this.questions.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!question) throw new NotFoundException();
    this.assertCanEditCategory(user, question.category);
    const previousImages = [question.image, question.answerImage];
    const uploadedKeys: string[] = [];
    try {
      await this.applyQuestionInput(
        question,
        body,
        this.fileMap(files),
        true,
        uploadedKeys,
      );
      await this.questions.manager.transaction(async (manager) => {
        await manager.getRepository(QuestionEntity).save(question);
        if (!user.isStaff && question.category.isApproved) {
          question.category.isApproved = false;
          await manager.getRepository(CategoryEntity).save(question.category);
        }
      });
      await this.removeImagesBestEffort(
        previousImages.filter(
          (key): key is string =>
            Boolean(key) &&
            key !== question.image &&
            key !== question.answerImage,
        ),
      );
    } catch (error) {
      await this.removeImagesBestEffort(uploadedKeys);
      throw error;
    }
    return this.serializeQuestion(question);
  }

  async deleteQuestion(id: number, user: UserEntity) {
    const question = await this.questions.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!question) throw new NotFoundException();
    this.assertCanEditCategory(user, question.category);
    await this.questions.remove(question);
    await this.removeImagesBestEffort([question.image, question.answerImage]);
  }

  async listUserCategories(
    query: Record<string, string | string[] | undefined>,
    user: UserEntity,
  ) {
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.categories.findAndCount({
      where: user.isStaff
        ? { isCustom: true }
        : {
            isCustom: true,
            isApproved: true,
            isHidden: false,
            privacy: 'public',
            createdById: Not(user.id),
          },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    const stats = await this.loadUserCategoryStats(rows, user.id);
    return paginated(
      await Promise.all(
        rows.map((item) => this.serializeUserCategory(item, user, stats)),
      ),
      total,
      offset,
      limit,
    );
  }

  async getUserCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    return this.serializeUserCategory(category, user);
  }

  async createUserCategory(
    user: UserEntity,
    body: CreateCategoryDto,
    files: UploadInput,
  ) {
    if (!stringValue(body.name).trim())
      throw new BadRequestException({ name: ['This field is required.'] });
    const uploadMap = this.fileMap(files);
    const inputs = this.parseQuestionInputs(body, uploadMap);
    const uploadedKeys: string[] = [];
    let category: CategoryEntity;
    try {
      category = await this.categories.manager.transaction(async (manager) => {
        const categoryRepository = manager.getRepository(CategoryEntity);
        const savedRepository = manager.getRepository(SavedCategoryEntity);
        const created = categoryRepository.create({
          name: stringValue(body.name).trim(),
          description: stringValue(body.description),
          privacy:
            body.privacy === CategoryPrivacy.Private ? 'private' : 'public',
          isCustom: true,
          isApproved: false,
          isHidden: false,
          locked: false,
          createdById: user.id,
        });
        const categoryImage = uploadMap.get('image');
        if (categoryImage) {
          const stored = await this.storeAndTrackImage(
            categoryImage,
            'categories',
            uploadedKeys,
          );
          created.image = stored.key;
        }
        await categoryRepository.save(created);
        await this.saveQuestionBatch(manager, created.id, inputs, uploadedKeys);
        await savedRepository.upsert(
          { userId: user.id, categoryId: created.id },
          ['userId', 'categoryId'],
        );
        return created;
      });
    } catch (error) {
      await this.removeImagesBestEffort(uploadedKeys);
      throw error;
    }
    category.createdBy = user;
    return {
      message: 'Category created successfully and submitted for approval',
      category: await this.serializeUserCategory(category, user),
    };
  }

  async updateUserCategory(
    id: number,
    user: UserEntity,
    body: UpdateCategoryDto,
    files: UploadInput,
  ) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    const uploadMap = this.fileMap(files);
    const inputs = this.parseQuestionInputs(body, uploadMap);
    const substantiveChange =
      body.name !== undefined ||
      body.description !== undefined ||
      body.privacy !== undefined ||
      inputs.length > 0 ||
      uploadMap.has('image');
    const uploadedKeys: string[] = [];
    const previousImage = category.image;
    try {
      await this.categories.manager.transaction(async (manager) => {
        const categoryRepository = manager.getRepository(CategoryEntity);
        if (body.name !== undefined)
          category.name = stringValue(body.name).trim();
        if (body.description !== undefined)
          category.description = stringValue(body.description);
        if (body.privacy !== undefined)
          category.privacy =
            body.privacy === CategoryPrivacy.Private ? 'private' : 'public';
        if (uploadMap.get('image')) {
          const stored = await this.storeAndTrackImage(
            uploadMap.get('image')!,
            'categories',
            uploadedKeys,
          );
          category.image = stored.key;
        }
        if (!user.isStaff && substantiveChange) {
          category.isApproved = false;
        }
        await categoryRepository.save(category);
        await this.saveQuestionBatch(
          manager,
          category.id,
          inputs,
          uploadedKeys,
        );
      });
      if (previousImage && previousImage !== category.image) {
        await this.removeImagesBestEffort([previousImage]);
      }
    } catch (error) {
      await this.removeImagesBestEffort(uploadedKeys);
      throw error;
    }
    return this.serializeUserCategory(category, user);
  }

  async deleteUserCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    const questions = await this.questions.findBy({ categoryId: id });
    await this.categories.remove(category);
    await this.removeImagesBestEffort([
      category.image,
      ...questions.flatMap((question) => [
        question.image,
        question.answerImage,
      ]),
    ]);
  }

  async myCategories(
    query: Record<string, string | string[] | undefined>,
    user: UserEntity,
  ) {
    const { limit, offset } = parsePagination(query);
    const [rows, total] = await this.categories.findAndCount({
      where: { isCustom: true, createdById: user.id },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    const stats = await this.loadUserCategoryStats(rows, user.id);
    return paginated(
      await Promise.all(
        rows.map((item) => this.serializeUserCategory(item, user, stats)),
      ),
      total,
      offset,
      limit,
    );
  }

  async addQuestions(
    id: number,
    user: UserEntity,
    body: AddQuestionsDto,
    files: UploadInput,
  ) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    const inputs = this.parseQuestionInputs(body, this.fileMap(files));
    if (!inputs.length)
      throw new BadRequestException({ error: 'No questions provided' });
    const uploadedKeys: string[] = [];
    try {
      await this.questions.manager.transaction(async (manager) => {
        await this.saveQuestionBatch(
          manager,
          category.id,
          inputs,
          uploadedKeys,
        );
        if (!user.isStaff && category.isApproved) {
          category.isApproved = false;
          await manager.getRepository(CategoryEntity).save(category);
        }
      });
    } catch (error) {
      await this.removeImagesBestEffort(uploadedKeys);
      throw error;
    }
    return {
      message: `Added ${inputs.length} questions to category "${category.name}"`,
      category: await this.serializeUserCategory(category, user),
    };
  }

  async saveCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    const result = await this.saved
      .createQueryBuilder()
      .insert()
      .into(SavedCategoryEntity)
      .values({ userId: user.id, categoryId: id })
      .orIgnore()
      .execute();
    const created = result.identifiers.length > 0;
    return {
      message: !created
        ? `Category "${category.name}" is already in your collection`
        : `Category "${category.name}" added to your collection`,
      category: await this.serializeUserCategory(category, user),
      saved: created,
    };
  }

  async unsaveCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    const result = await this.saved.delete({ userId: user.id, categoryId: id });
    if (!result.affected)
      throw new NotFoundException({
        message: `Category "${category.name}" was not in your collection`,
        removed: false,
      });
    return {
      message: `Category "${category.name}" removed from your collection`,
      removed: true,
    };
  }

  async mySavedCategories(
    user: UserEntity,
    query: Record<string, string | string[] | undefined> = {},
  ) {
    const hasPagination =
      query.limit !== undefined || query.offset !== undefined;
    const { limit, offset } = parsePagination(query, 50, 100);
    const builder = this.visibleSavedCategoryQuery(user);
    const [links, total] = await builder
      .skip(hasPagination ? offset : 0)
      .take(hasPagination ? limit : 100)
      .getManyAndCount();
    const categories = links.map((link) => link.category).filter(Boolean);
    const stats = await this.loadUserCategoryStats(categories, user.id);
    const results = await Promise.all(
      categories.map((item) => this.serializeUserCategory(item, user, stats)),
    );
    return hasPagination ? paginated(results, total, offset, limit) : results;
  }

  async likeCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    if (category.createdById === user.id)
      throw new BadRequestException({
        error: "You can't like your own category.",
      });
    await this.likes.upsert({ userId: user.id, categoryId: id }, [
      'userId',
      'categoryId',
    ]);
    return {
      liked: true,
      likes_count: await this.likes.countBy({ categoryId: id }),
    };
  }

  async unlikeCategory(id: number, user: UserEntity) {
    await this.getVisibleUserCategory(id, user);
    await this.likes.delete({ userId: user.id, categoryId: id });
    return {
      liked: false,
      likes_count: await this.likes.countBy({ categoryId: id }),
    };
  }

  async serializeCategory(
    category: CategoryEntity,
    user?: UserEntity,
    basic = false,
    stats?: CategoryStats,
  ) {
    const common = this.categorySummary(category);
    if (basic) return common;
    const questionsCount =
      stats?.questionsCount ??
      (await this.questions.countBy({
        categoryId: category.id,
      }));
    return {
      ...common,
      questions_count: questionsCount,
      total_questions: questionsCount,
      user_played_questions: user
        ? (stats?.playedCount ??
          (await this.userPlayedCount(category.id, user.id)))
        : 0,
      is_custom: category.isCustom,
      is_approved: category.isApproved,
      privacy: category.privacy,
      created_by_id: category.createdById ? Number(category.createdById) : null,
    };
  }

  async serializeCategories(categories: CategoryEntity[], user?: UserEntity) {
    const stats = await this.loadCategoryStats(categories, user);
    return Promise.all(
      categories.map((category) =>
        this.serializeCategory(
          category,
          user,
          false,
          stats.get(Number(category.id)),
        ),
      ),
    );
  }

  private async loadCategoryStats(
    categories: CategoryEntity[],
    user?: UserEntity,
  ) {
    const stats = new Map<number, CategoryStats>();
    const categoryIds = categories.map((category) => Number(category.id));
    if (!categoryIds.length) return stats;
    for (const categoryId of categoryIds) {
      stats.set(categoryId, { questionsCount: 0, playedCount: 0 });
    }
    const questionRows = await this.questions
      .createQueryBuilder('question')
      .select('question.categoryId', 'categoryId')
      .addSelect('COUNT(question.id)', 'count')
      .where('question.categoryId IN (:...categoryIds)', { categoryIds })
      .groupBy('question.categoryId')
      .getRawMany<{ categoryId: string; count: string }>();
    for (const row of questionRows) {
      stats.get(Number(row.categoryId))!.questionsCount = Number(row.count);
    }
    if (!user) return stats;
    const playedRows = await this.played
      .createQueryBuilder('played')
      .innerJoin('played.game', 'game')
      .innerJoin('played.question', 'question')
      .select('question.categoryId', 'categoryId')
      .addSelect('COUNT(DISTINCT played.questionId)', 'count')
      .where('game.playerId = :userId', { userId: user.id })
      .andWhere('question.categoryId IN (:...categoryIds)', { categoryIds })
      .groupBy('question.categoryId')
      .getRawMany<{ categoryId: string; count: string }>();
    for (const row of playedRows) {
      const categoryId = Number(row.categoryId);
      stats.get(categoryId)!.playedCount = Number(row.count);
    }
    return stats;
  }

  serializeQuestion(question: QuestionEntity) {
    return {
      id: Number(question.id),
      category: question.category
        ? this.categorySummary(question.category)
        : undefined,
      category_name: question.category?.name,
      text: question.text,
      text_ar: question.textAr,
      answer: question.answer,
      choice_2: question.choice2,
      choice_3: question.choice3,
      choice_4: question.choice4,
      answer_ar: question.answerAr,
      image: this.media.url(question.image),
      answer_image: this.media.url(question.answerImage),
      difficulty: question.difficulty,
      points: Number(question.difficulty),
    };
  }

  categorySummary(category: CategoryEntity) {
    return {
      id: Number(category.id),
      name: category.name,
      locked: category.locked,
      is_premium: category.locked,
      image: this.media.url(category.image),
      description: category.description,
    };
  }

  private async serializeUserCategory(
    category: CategoryEntity,
    user: UserEntity,
    stats?: Map<number, UserCategoryStats>,
  ) {
    const categoryStats = stats?.get(Number(category.id));
    const questionsCount =
      categoryStats?.questionsCount ??
      (await this.questions.countBy({ categoryId: category.id }));
    const creator = category.createdBy;
    const expiry = creator?.profile?.premiumExpiry;
    const creatorPremium = Boolean(
      creator?.profile?.isPremium &&
      (!expiry || expiry >= new Date().toISOString().slice(0, 10)),
    );
    return {
      id: Number(category.id),
      name: category.name,
      description: category.description,
      image_url: this.media.url(category.image),
      privacy: category.privacy,
      is_custom: category.isCustom,
      is_approved: category.isApproved,
      created_by: category.createdById ? Number(category.createdById) : null,
      created_by_id: category.createdById ? Number(category.createdById) : null,
      created_by_username: creator?.username || null,
      created_by_avatar: this.media.url(creator?.profile?.avatar),
      created_by_is_premium: creatorPremium,
      created_at: category.createdAt,
      updated_at: category.updatedAt,
      questions_count: questionsCount,
      total_questions: questionsCount,
      user_played_questions:
        categoryStats?.playedCount ??
        (await this.userPlayedCount(category.id, user.id)),
      is_premium: category.locked,
      is_saved:
        categoryStats?.saved.has(Number(category.id)) ??
        (await this.saved.exists({
          where: { userId: user.id, categoryId: category.id },
        })),
      saves_count:
        categoryStats?.savesCount ??
        (await this.saved.countBy({ categoryId: category.id })),
      likes_count:
        categoryStats?.likesCount ??
        (await this.likes.countBy({ categoryId: category.id })),
      is_liked:
        categoryStats?.liked.has(Number(category.id)) ??
        (await this.likes.exists({
          where: { userId: user.id, categoryId: category.id },
        })),
    };
  }

  private async loadUserCategoryStats(
    categories: CategoryEntity[],
    userId: number,
  ): Promise<Map<number, UserCategoryStats>> {
    const categoryIds = categories.map((category) => Number(category.id));
    const stats = new Map<number, UserCategoryStats>();
    if (!categoryIds.length) return stats;
    categoryIds.forEach((id) =>
      stats.set(id, {
        questionsCount: 0,
        playedCount: 0,
        savesCount: 0,
        likesCount: 0,
        saved: new Set<number>(),
        liked: new Set<number>(),
      }),
    );

    const [questions, played, saves, likes, savedByUser, likedByUser] =
      await Promise.all([
        this.questions
          .createQueryBuilder('question')
          .select('question.category_id', 'category_id')
          .addSelect('COUNT(*)', 'count')
          .where('question.category_id IN (:...categoryIds)', { categoryIds })
          .groupBy('question.category_id')
          .getRawMany<{ category_id: string; count: string }>(),
        this.played
          .createQueryBuilder('played')
          .innerJoin(GameEntity, 'game', 'game.id = played.game_id')
          .innerJoin(
            QuestionEntity,
            'question',
            'question.id = played.question_id',
          )
          .select('question.category_id', 'category_id')
          .addSelect('COUNT(DISTINCT played.question_id)', 'count')
          .where('game.player_id = :userId', { userId })
          .andWhere('question.category_id IN (:...categoryIds)', {
            categoryIds,
          })
          .groupBy('question.category_id')
          .getRawMany<{ category_id: string; count: string }>(),
        this.saved
          .createQueryBuilder('saved')
          .select('saved.category_id', 'category_id')
          .addSelect('COUNT(*)', 'count')
          .where('saved.category_id IN (:...categoryIds)', { categoryIds })
          .groupBy('saved.category_id')
          .getRawMany<{ category_id: string; count: string }>(),
        this.likes
          .createQueryBuilder('categoryLike')
          .select('categoryLike.category_id', 'category_id')
          .addSelect('COUNT(*)', 'count')
          .where('categoryLike.category_id IN (:...categoryIds)', {
            categoryIds,
          })
          .groupBy('categoryLike.category_id')
          .getRawMany<{ category_id: string; count: string }>(),
        this.saved.findBy({ userId, categoryId: In(categoryIds) }),
        this.likes.findBy({ userId, categoryId: In(categoryIds) }),
      ]);

    for (const row of questions) {
      stats.get(Number(row.category_id))!.questionsCount = Number(row.count);
    }
    for (const row of played) {
      stats.get(Number(row.category_id))!.playedCount = Number(row.count);
    }
    for (const row of saves) {
      stats.get(Number(row.category_id))!.savesCount = Number(row.count);
    }
    for (const row of likes) {
      stats.get(Number(row.category_id))!.likesCount = Number(row.count);
    }
    savedByUser.forEach((item) =>
      stats.get(Number(item.categoryId))?.saved.add(Number(item.categoryId)),
    );
    likedByUser.forEach((item) =>
      stats.get(Number(item.categoryId))?.liked.add(Number(item.categoryId)),
    );
    return stats;
  }

  private assertCategoryAccess(
    user: UserEntity | undefined,
    category: CategoryEntity,
  ) {
    if (!this.canAccessCategory(user, category)) {
      if (
        category.isCustom &&
        category.createdById !== user?.id &&
        (!category.isApproved || category.privacy !== 'public')
      ) {
        throw new NotFoundException();
      }
      throw new ForbiddenException({
        detail: 'You do not have access to this category.',
      });
    }
  }

  private assertCanEditCategory(user: UserEntity, category: CategoryEntity) {
    if (
      !user.isStaff &&
      (!category.isCustom || category.createdById !== user.id)
    ) {
      throw new ForbiddenException({
        error: 'You do not have permission to modify this category',
      });
    }
  }

  private async getVisibleUserCategory(id: number, user: UserEntity) {
    const category = await this.categories.findOne({
      where: { id, isCustom: true },
      relations: { createdBy: { profile: true } },
    });
    if (!category) throw new NotFoundException();
    if (
      !user.isStaff &&
      category.createdById !== user.id &&
      (!category.isApproved ||
        category.privacy !== 'public' ||
        category.isHidden)
    ) {
      throw new NotFoundException();
    }
    return category;
  }

  private async visibleSavedCategories(user: UserEntity) {
    return (await this.visibleSavedCategoryQuery(user).getMany())
      .map((link) => link.category)
      .filter(Boolean);
  }

  private visibleSavedCategoryQuery(user: UserEntity) {
    const builder = this.saved
      .createQueryBuilder('saved')
      .innerJoinAndSelect('saved.category', 'category')
      .leftJoinAndSelect('category.createdBy', 'createdBy')
      .leftJoinAndSelect('createdBy.profile', 'profile')
      .where('saved.user_id = :userId', { userId: user.id })
      .orderBy('saved.saved_at', 'DESC');
    if (!user.isStaff) {
      builder.andWhere(
        `category.is_hidden = false AND (
          category.is_custom = false OR
          category.created_by_id = :userId OR
          (category.is_approved = true AND category.privacy = 'public')
        )`,
        { userId: user.id },
      );
    }
    return builder;
  }

  private async userPlayedCount(
    categoryId: number,
    userId: number,
  ): Promise<number> {
    const result = await this.played
      .createQueryBuilder('played')
      .innerJoin(GameEntity, 'game', 'game.id = played.game_id')
      .innerJoin(QuestionEntity, 'question', 'question.id = played.question_id')
      .where('game.player_id = :userId', { userId })
      .andWhere('question.category_id = :categoryId', { categoryId })
      .select('COUNT(DISTINCT question.id)', 'count')
      .getRawOne<{ count: string }>();
    return Number(result?.count || 0);
  }

  private async saveQuestionBatch(
    manager: EntityManager,
    categoryId: number,
    inputs: Array<{
      body: CreateQuestionInputDto;
      files: UploadMap;
    }>,
    uploadedKeys: string[],
  ) {
    const repository = manager.getRepository(QuestionEntity);
    for (const input of inputs) {
      const question = repository.create({ categoryId });
      await this.applyQuestionInput(
        question,
        input.body,
        input.files,
        false,
        uploadedKeys,
      );
      await repository.save(question);
    }
  }

  private async applyQuestionInput(
    question: QuestionEntity,
    body: CreateQuestionInputDto | CreateQuestionDto | UpdateQuestionDto,
    files: UploadMap,
    partial = false,
    uploadedKeys: string[] = [],
  ) {
    if (!partial && !stringValue(body.text).trim())
      throw new BadRequestException({ text: ['This field is required.'] });
    if (!partial && !stringValue(body.answer).trim())
      throw new BadRequestException({ answer: ['This field is required.'] });
    if (body.text !== undefined) question.text = stringValue(body.text);
    if (body.text_ar !== undefined) question.textAr = stringValue(body.text_ar);
    if (body.answer !== undefined) question.answer = stringValue(body.answer);
    if (body.choice_2 !== undefined)
      question.choice2 = stringValue(body.choice_2) || null;
    if (body.choice_3 !== undefined)
      question.choice3 = stringValue(body.choice_3) || null;
    if (body.choice_4 !== undefined)
      question.choice4 = stringValue(body.choice_4) || null;
    if (body.answer_ar !== undefined)
      question.answerAr = stringValue(body.answer_ar);
    const difficulty = body.difficulty ?? body.points;
    if (difficulty !== undefined) {
      const value = stringValue(difficulty);
      if (!['200', '400', '600'].includes(value))
        throw new BadRequestException({
          points: ['Must be 200, 400, or 600.'],
        });
      question.difficulty = value;
    }
    if (!question.difficulty) question.difficulty = '200';
    if (question.randomKey === undefined) question.randomKey = Math.random();
    if (files.get('image')) {
      const stored = await this.storeAndTrackImage(
        files.get('image')!,
        'questions',
        uploadedKeys,
      );
      question.image = stored.key;
      question.imageHash = stored.hash;
    }
    if (files.get('answer_image')) {
      const stored = await this.storeAndTrackImage(
        files.get('answer_image')!,
        'answers',
        uploadedKeys,
      );
      question.answerImage = stored.key;
      question.answerImageHash = stored.hash;
    }
  }

  private async storeAndTrackImage(
    file: Express.Multer.File,
    folder: 'avatars' | 'categories' | 'questions' | 'answers',
    uploadedKeys: string[],
  ) {
    const stored = await this.media.storeImage(file, folder);
    uploadedKeys.push(stored.key);
    return stored;
  }

  private async removeImagesBestEffort(
    keys: Iterable<string | null | undefined>,
  ) {
    try {
      const stringKeys = [...keys].filter((key): key is string => Boolean(key));
      await this.media.removeImages(stringKeys);
    } catch (error) {
      this.logger.error('Failed to clean up uploaded media', error);
    }
  }

  private parseQuestionInputs(
    body: CreateCategoryDto | UpdateCategoryDto | AddQuestionsDto,
    uploads: UploadMap,
  ) {
    const values = new Map<number, CreateQuestionInputDto>();
    const raw = body.questions;
    if (typeof raw === 'string') {
      const parsed = parseQuestionJson(raw);
      if (Array.isArray(parsed))
        parsed.forEach((item, index) =>
          values.set(index, item as CreateQuestionInputDto),
        );
    } else if (Array.isArray(raw)) {
      raw.forEach((item, index) => values.set(index, item));
    }
    for (const [index, item] of collectIndexedQuestionFields(
      Object.entries(body),
    )) {
      values.set(index, {
        ...(values.get(index) || {}),
        ...item,
      } as CreateQuestionInputDto);
    }
    for (const key of uploads.keys()) {
      const match = key.match(/^questions\[(\d+)]\[(image|answer_image)]$/);
      if (match && !values.has(Number(match[1])))
        values.set(Number(match[1]), {} as CreateQuestionInputDto);
    }
    return [...values.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, item]) => ({
        body: item,
        files: new Map<string, Express.Multer.File>([
          ...(uploads.get(`questions[${index}][image]`)
            ? [['image', uploads.get(`questions[${index}][image]`)!] as const]
            : []),
          ...(uploads.get(`questions[${index}][answer_image]`)
            ? [
                [
                  'answer_image',
                  uploads.get(`questions[${index}][answer_image]`)!,
                ] as const,
              ]
            : []),
        ]),
      }));
  }

  private fileMap(files: UploadInput = []): UploadMap {
    const list = Array.isArray(files) ? files : Object.values(files).flat();
    return new Map(list.map((file) => [file.fieldname, file]));
  }

  private queryArray(value?: string | string[]): string[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(','))
      .filter(Boolean);
  }
}
