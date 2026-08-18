import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { integerId, paginated, stringValue } from '../common/utils';
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

type UploadMap = Map<string, Express.Multer.File>;

@Injectable()
export class ContentService {
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
    if (!category.locked) return true;
    if (!user?.profile?.isPremium) return false;
    const expiry = user.profile.premiumExpiry;
    return !expiry || expiry >= new Date().toISOString().slice(0, 10);
  }

  async listCollections(user?: UserEntity) {
    const rows = await this.collections.find({
      order: { order: 'ASC', name: 'ASC' },
    });
    return paginated(
      await Promise.all(
        rows.map(async (collection) => {
          const categories = await this.categories.find({
            where: { collectionId: collection.id },
            relations: { createdBy: { profile: true } },
          });
          return {
            id: Number(collection.id),
            name: collection.name,
            order: collection.order,
            categories: await Promise.all(
              categories.map((item) => this.serializeCategory(item, user)),
            ),
            categories_count: categories.length,
          };
        }),
      ),
    );
  }

  async getCollection(id: number, user?: UserEntity) {
    const collection = await this.collections.findOneBy({ id });
    if (!collection) throw new NotFoundException();
    const categories = await this.categories.find({
      where: { collectionId: id },
      relations: { createdBy: { profile: true } },
    });
    return {
      id: Number(collection.id),
      name: collection.name,
      order: collection.order,
      categories: await Promise.all(
        categories.map((item) => this.serializeCategory(item, user)),
      ),
      categories_count: categories.length,
    };
  }

  async collectionsWithCategories(user?: UserEntity) {
    const collections = await this.collections.find({
      order: { order: 'ASC', name: 'ASC' },
    });
    const official = await this.categories.find({
      where: { isCustom: false, isHidden: false },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
    });
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
        categories: await Promise.all(
          items.map((item) => this.serializeCategory(item, user)),
        ),
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
        categories: await Promise.all(
          uncategorized.map((item) => this.serializeCategory(item, user)),
        ),
        categories_count: uncategorized.length,
      });
    }
    return output.sort((a, b) => Number(a.order) - Number(b.order));
  }

  async allCategoryData(user?: UserEntity) {
    const collections = await this.collectionsWithCategories(user);
    const fallback = await this.categories.find({
      where: { isCustom: false, isHidden: false, collectionId: IsNull() },
      relations: { createdBy: { profile: true } },
    });
    const savedCategories = user ? await this.visibleSavedCategories(user) : [];
    return {
      collections: collections.filter((item) => item.id !== -1),
      saved_categories: await Promise.all(
        savedCategories.map((item) => this.serializeUserCategory(item, user!)),
      ),
      fallback_categories: await Promise.all(
        fallback.map((item) => this.serializeCategory(item, user)),
      ),
    };
  }

  async listOfficialCategories(user?: UserEntity) {
    const rows = await this.categories.find({
      where: { isCustom: false },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
    });
    return paginated(
      await Promise.all(rows.map((item) => this.serializeCategory(item, user))),
    );
  }

  async getOfficialCategory(id: number, user?: UserEntity) {
    const category = await this.categories.findOne({
      where: { id, isCustom: false },
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
    const unknown = keys.filter((key) => key !== 'category_id');
    if (unknown.length) {
      throw new BadRequestException({
        detail: `Unknown query parameter(s): ${unknown.join(', ')}. Only 'category_id' is permitted.`,
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
    const rows = await this.questions.find({
      where: { categoryId },
      relations: { category: true },
    });
    return paginated(rows.map((item) => this.serializeQuestion(item)));
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
    body: Record<string, unknown>,
    files: Express.Multer.File[],
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
    await this.applyQuestionInput(question, body, this.fileMap(files));
    await this.questions.save(question);
    question.category = category;
    return this.serializeQuestion(question);
  }

  async updateQuestion(
    id: number,
    user: UserEntity,
    body: Record<string, unknown>,
    files: Express.Multer.File[],
  ) {
    const question = await this.questions.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!question) throw new NotFoundException();
    this.assertCanEditCategory(user, question.category);
    await this.applyQuestionInput(question, body, this.fileMap(files), true);
    await this.questions.save(question);
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
  }

  async listUserCategories(user: UserEntity) {
    const rows = await this.categories.find({
      where: user.isStaff
        ? { isCustom: true }
        : {
            isCustom: true,
            isApproved: true,
            privacy: 'public',
            createdById: Not(user.id),
          },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
    });
    return paginated(
      await Promise.all(
        rows.map((item) => this.serializeUserCategory(item, user)),
      ),
    );
  }

  async getUserCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    return this.serializeUserCategory(category, user);
  }

  async createUserCategory(
    user: UserEntity,
    body: Record<string, unknown>,
    files: Express.Multer.File[],
  ) {
    if (!stringValue(body.name).trim())
      throw new BadRequestException({ name: ['This field is required.'] });
    const category = this.categories.create({
      name: stringValue(body.name).trim(),
      description: stringValue(body.description),
      privacy: body.privacy === 'private' ? 'private' : 'public',
      isCustom: true,
      isApproved: false,
      isHidden: false,
      locked: false,
      createdById: user.id,
    });
    const uploadMap = this.fileMap(files);
    const categoryImage = uploadMap.get('image');
    if (categoryImage)
      category.image = (
        await this.media.storeImage(categoryImage, 'categories')
      ).key;
    await this.categories.save(category);
    category.createdBy = user;
    const inputs = this.parseQuestionInputs(body, uploadMap);
    for (const input of inputs) {
      const question = this.questions.create({ categoryId: category.id });
      await this.applyQuestionInput(question, input.body, input.files);
      await this.questions.save(question);
    }
    await this.saved.upsert({ userId: user.id, categoryId: category.id }, [
      'userId',
      'categoryId',
    ]);
    return {
      message: 'Category created successfully and submitted for approval',
      category: await this.serializeUserCategory(category, user),
    };
  }

  async updateUserCategory(
    id: number,
    user: UserEntity,
    body: Record<string, unknown>,
    files: Express.Multer.File[],
  ) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    if (body.name !== undefined) category.name = stringValue(body.name).trim();
    if (body.description !== undefined)
      category.description = stringValue(body.description);
    if (body.privacy !== undefined)
      category.privacy = body.privacy === 'private' ? 'private' : 'public';
    const uploadMap = this.fileMap(files);
    if (uploadMap.get('image'))
      category.image = (
        await this.media.storeImage(uploadMap.get('image')!, 'categories')
      ).key;
    await this.categories.save(category);
    const inputs = this.parseQuestionInputs(body, uploadMap);
    for (const input of inputs) {
      const question = this.questions.create({ categoryId: category.id });
      await this.applyQuestionInput(question, input.body, input.files);
      await this.questions.save(question);
    }
    return this.serializeUserCategory(category, user);
  }

  async deleteUserCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    await this.categories.remove(category);
  }

  async myCategories(user: UserEntity) {
    const rows = await this.categories.find({
      where: { isCustom: true, createdById: user.id },
      relations: { createdBy: { profile: true } },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      rows.map((item) => this.serializeUserCategory(item, user)),
    );
  }

  async addQuestions(
    id: number,
    user: UserEntity,
    body: Record<string, unknown>,
    files: Express.Multer.File[],
  ) {
    const category = await this.getVisibleUserCategory(id, user);
    this.assertCanEditCategory(user, category);
    const inputs = this.parseQuestionInputs(body, this.fileMap(files));
    if (!inputs.length)
      throw new BadRequestException({ error: 'No questions provided' });
    for (const input of inputs) {
      const question = this.questions.create({ categoryId: category.id });
      await this.applyQuestionInput(question, input.body, input.files);
      await this.questions.save(question);
    }
    return {
      message: `Added ${inputs.length} questions to category "${category.name}"`,
      category: await this.serializeUserCategory(category, user),
    };
  }

  async saveCategory(id: number, user: UserEntity) {
    const category = await this.getVisibleUserCategory(id, user);
    const exists = await this.saved.exists({
      where: { userId: user.id, categoryId: id },
    });
    if (!exists)
      await this.saved.save(
        this.saved.create({ userId: user.id, categoryId: id }),
      );
    return {
      message: exists
        ? `Category "${category.name}" is already in your collection`
        : `Category "${category.name}" added to your collection`,
      category: await this.serializeUserCategory(category, user),
      saved: !exists,
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

  async mySavedCategories(user: UserEntity) {
    const categories = await this.visibleSavedCategories(user);
    return Promise.all(
      categories.map((item) => this.serializeUserCategory(item, user)),
    );
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
  ) {
    const common = {
      id: Number(category.id),
      name: category.name,
      locked: category.locked,
      is_premium: category.locked,
      image: this.media.url(category.image),
      description: category.description,
    };
    if (basic) return common;
    const questionsCount = await this.questions.countBy({
      categoryId: category.id,
    });
    return {
      ...common,
      questions_count: questionsCount,
      total_questions: questionsCount,
      user_played_questions: user
        ? await this.userPlayedCount(category.id, user.id)
        : 0,
      is_custom: category.isCustom,
      is_approved: category.isApproved,
      privacy: category.privacy,
      created_by_id: category.createdById ? Number(category.createdById) : null,
    };
  }

  serializeQuestion(question: QuestionEntity) {
    return {
      id: Number(question.id),
      category: question.category
        ? {
            id: Number(question.category.id),
            name: question.category.name,
            locked: question.category.locked,
            is_premium: question.category.locked,
            image: this.media.url(question.category.image),
            description: question.category.description,
          }
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

  private async serializeUserCategory(
    category: CategoryEntity,
    user: UserEntity,
  ) {
    const questionsCount = await this.questions.countBy({
      categoryId: category.id,
    });
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
      user_played_questions: await this.userPlayedCount(category.id, user.id),
      is_premium: category.locked,
      is_saved: await this.saved.exists({
        where: { userId: user.id, categoryId: category.id },
      }),
      saves_count: await this.saved.countBy({ categoryId: category.id }),
      likes_count: await this.likes.countBy({ categoryId: category.id }),
      is_liked: await this.likes.exists({
        where: { userId: user.id, categoryId: category.id },
      }),
    };
  }

  private assertCategoryAccess(
    user: UserEntity | undefined,
    category: CategoryEntity,
  ) {
    if (!this.canAccessCategory(user, category)) {
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
      !(category.isApproved && category.privacy === 'public')
    ) {
      throw new NotFoundException();
    }
    return category;
  }

  private async visibleSavedCategories(user: UserEntity) {
    const links = await this.saved.find({
      where: { userId: user.id },
      relations: { category: { createdBy: { profile: true } } },
      order: { savedAt: 'DESC' },
    });
    return links
      .map((link) => link.category)
      .filter(
        (category) =>
          category.createdById === user.id ||
          (category.isCustom &&
            category.isApproved &&
            category.privacy === 'public'),
      );
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

  private async applyQuestionInput(
    question: QuestionEntity,
    body: Record<string, unknown>,
    files: UploadMap,
    partial = false,
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
      const stored = await this.media.storeImage(
        files.get('image')!,
        'questions',
      );
      question.image = stored.key;
      question.imageHash = stored.hash;
    }
    if (files.get('answer_image')) {
      const stored = await this.media.storeImage(
        files.get('answer_image')!,
        'answers',
      );
      question.answerImage = stored.key;
      question.answerImageHash = stored.hash;
    }
  }

  private parseQuestionInputs(
    body: Record<string, unknown>,
    uploads: UploadMap,
  ) {
    const values = new Map<number, Record<string, unknown>>();
    const raw = body.questions;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
        if (Array.isArray(parsed))
          parsed.forEach((item, index) => values.set(index, item));
      } catch {
        throw new BadRequestException({ error: 'Invalid questions format' });
      }
    } else if (Array.isArray(raw)) {
      raw.forEach((item, index) =>
        values.set(index, item as Record<string, unknown>),
      );
    }
    for (const [key, value] of Object.entries(body)) {
      const match = key.match(/^questions\[(\d+)]\[(\w+)]$/);
      if (match)
        values.set(Number(match[1]), {
          ...(values.get(Number(match[1])) || {}),
          [match[2]]: value,
        });
    }
    for (const key of uploads.keys()) {
      const match = key.match(/^questions\[(\d+)]\[(image|answer_image)]$/);
      if (match && !values.has(Number(match[1])))
        values.set(Number(match[1]), {});
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

  private fileMap(files: Express.Multer.File[] = []): UploadMap {
    return new Map(files.map((file) => [file.fieldname, file]));
  }

  private queryArray(value?: string | string[]): string[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(','))
      .filter(Boolean);
  }
}
