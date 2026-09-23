import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  ActionRequest,
  ActionContext,
  BaseDatabase,
  BaseResource,
  CurrentAdmin,
  ListActionResponse,
  RecordJSON,
  RecordActionResponse,
  ResourceWithOptions,
} from 'adminjs';
import { ConfigService } from '@nestjs/config';
import { ValidationError, validate } from 'class-validator';
import { Router } from 'express';
import * as session from 'express-session';
import type { Session } from 'express-session';
import { resolve } from 'node:path';
import { DataSource, In, Raw } from 'typeorm';
import { PasswordService } from '../auth/password.service';
import {
  CategoryEntity,
  CategoryLikeEntity,
  CollectionEntity,
  GameCategoryEntity,
  GameEntity,
  PaymentEntity,
  PlayedQuestionEntity,
  QuestionEntity,
  SavedCategoryEntity,
  SubscriptionEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';
import { MediaService } from '../media/media.service';
import { PostgresSessionStore } from './postgres-session-store';

type NativeImport = (specifier: string) => Promise<unknown>;
type TypeOrmAdapterModule = {
  Database: typeof BaseDatabase;
  Resource: typeof BaseResource & { validate: typeof validate };
};

// AdminJS v7 is ESM-only while this NestJS project is compiled as CommonJS.
// Keeping the native import intact lets both module formats coexist.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeImport = new Function(
  'specifier',
  'return import(specifier)',
) as NativeImport;

const readOnlyActions = {
  new: { isAccessible: false },
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  bulkDelete: { isAccessible: false },
};

type EnrichedResponse =
  Pick<ListActionResponse, 'records'> | Pick<RecordActionResponse, 'record'>;

function responseRecords(response: EnrichedResponse): RecordJSON[] {
  if ('records' in response) return response.records;
  return [response.record];
}

function removeSensitiveValues(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(removeSensitiveValues);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  Object.keys(record).forEach((key) => {
    if (
      key === 'password' ||
      key === 'passwordHash' ||
      key === 'password_hash'
    ) {
      delete record[key];
      return;
    }
    removeSensitiveValues(record[key]);
  });
}

function stripSensitiveUserResponse<T extends EnrichedResponse>(
  response: T,
): T {
  responseRecords(response).forEach((record) =>
    removeSensitiveValues(record.params),
  );
  return response;
}

function validateAdminEntity(object: object): ValidationError[] {
  const values = object as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const type = object.constructor?.name;
  const add = (property: string, message: string) => {
    const error = new ValidationError();
    error.target = object;
    error.property = property;
    error.constraints = { admin: message };
    errors.push(error);
  };
  const requiredText = (property: string) => {
    if (typeof values[property] !== 'string' || !values[property].trim()) {
      add(property, `${property} must be a non-empty string`);
    }
  };
  const positiveInteger = (property: string) => {
    const value = values[property];
    if (
      !Number.isSafeInteger(
        typeof value === 'string' ? Number(value) : value,
      ) ||
      Number(value) <= 0
    ) {
      add(property, `${property} must be a positive integer`);
    }
  };

  if (type === UserEntity.name) {
    requiredText('username');
    if (
      typeof values.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())
    ) {
      add('email', 'email must be a valid email address');
    }
  } else if (type === CollectionEntity.name) {
    requiredText('name');
    if (!Number.isInteger(Number(values.order)))
      add('order', 'order must be an integer');
  } else if (type === CategoryEntity.name) {
    requiredText('name');
    if (values.privacy !== 'public' && values.privacy !== 'private') {
      add('privacy', 'privacy must be public or private');
    }
    if (values.collectionId !== null && values.collectionId !== undefined) {
      positiveInteger('collectionId');
    }
    if (values.createdById !== null && values.createdById !== undefined) {
      positiveInteger('createdById');
    }
  } else if (type === QuestionEntity.name) {
    positiveInteger('categoryId');
    requiredText('text');
    requiredText('answer');
    if (!['200', '400', '600'].includes(String(values.difficulty))) {
      add('difficulty', 'difficulty must be 200, 400, or 600');
    }
  }
  return errors;
}

function restrictUserWritePayload(
  request: ActionRequest,
  context: ActionContext,
): ActionRequest {
  const allowed = new Set([
    'username',
    'email',
    'firstName',
    'lastName',
    'isActive',
  ]);
  if (context.currentAdmin?.title === 'Superuser') {
    allowed.add('isStaff');
    allowed.add('isSuperuser');
  }
  if (request.payload) {
    request.payload = Object.fromEntries(
      Object.entries(request.payload).filter(([key]) => allowed.has(key)),
    );
  }
  return request;
}

function restrictPayloadTo(allowedProperties: string[]) {
  const allowed = new Set(allowedProperties);
  return (request: ActionRequest): ActionRequest => {
    if (request.payload) {
      request.payload = Object.fromEntries(
        Object.entries(request.payload).filter(([key]) => allowed.has(key)),
      );
    }
    return request;
  };
}

const collectionWritePayload = restrictPayloadTo(['name', 'order']);
function restrictProfileWritePayload(
  request: ActionRequest,
  context: ActionContext,
): ActionRequest {
  const allowed = new Set(['userId', 'avatar', 'bio']);
  if (context.currentAdmin?.title === 'Superuser') {
    allowed.add('isPremium');
    allowed.add('premiumExpiry');
  }
  if (request.payload) {
    request.payload = Object.fromEntries(
      Object.entries(request.payload).filter(([key]) => allowed.has(key)),
    );
  }
  return request;
}
const categoryWritePayload = restrictPayloadTo([
  'name',
  'description',
  'image',
  'collectionId',
  'locked',
  'isHidden',
  'isCustom',
  'isApproved',
  'privacy',
]);
const questionWritePayload = restrictPayloadTo([
  'categoryId',
  'text',
  'textAr',
  'answer',
  'answerAr',
  'choice2',
  'choice3',
  'choice4',
  'difficulty',
  'image',
  'answerImage',
  'randomKey',
]);

async function addUserDetailsAndStrip<T extends EnrichedResponse>(
  response: T,
): Promise<T> {
  return stripSensitiveUserResponse(await addUserDetails(response));
}

function numericParam(record: RecordJSON, property: string): number {
  const value: unknown = record.params[property];
  return typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
}

async function addUserDetails<T extends EnrichedResponse>(
  response: T,
): Promise<T> {
  const records = responseRecords(response);
  const ids = records
    .map((record) => numericParam(record, 'id'))
    .filter(Number.isFinite);
  if (!ids.length) return response;

  const profiles = await UserProfileEntity.findBy({ userId: In(ids) });
  const byUser = new Map(
    profiles.map((profile) => [Number(profile.userId), profile]),
  );
  records.forEach((record) => {
    const profile = byUser.get(numericParam(record, 'id'));
    record.params.profileAvatar = profile?.avatar || '';
    record.params.profileBio = profile?.bio || '';
    record.params.profileIsPremium = profile?.isPremium || false;
    record.params.profilePremiumExpiry = profile?.premiumExpiry || '';
  });
  return response;
}

async function addProfileDetails<T extends EnrichedResponse>(
  response: T,
): Promise<T> {
  const records = responseRecords(response);
  const userIds = records
    .map((record) => numericParam(record, 'userId'))
    .filter(Number.isFinite);
  if (!userIds.length) return response;

  const users = await UserEntity.findBy({ id: In(userIds) });
  const byId = new Map(users.map((user) => [Number(user.id), user]));
  records.forEach((record) => {
    const user = byId.get(numericParam(record, 'userId'));
    record.params.userUsername = user?.username || '';
    record.params.userEmail = user?.email || '';
  });
  return response;
}

async function addCategoryDetails<T extends EnrichedResponse>(
  response: T,
): Promise<T> {
  const records = responseRecords(response);
  await Promise.all(
    records.map(async (record) => {
      const categoryId = numericParam(record, 'id');
      record.params.likesCount = Number.isFinite(categoryId)
        ? await CategoryLikeEntity.countBy({ categoryId })
        : 0;
    }),
  );
  return response;
}

function addQuestionDetails<T extends EnrichedResponse>(response: T): T {
  responseRecords(response).forEach((record) => {
    const difficulty: unknown = record.params.difficulty;
    const image: unknown = record.params.image;
    const answerImage: unknown = record.params.answerImage;
    record.params.points =
      typeof difficulty === 'number' || typeof difficulty === 'string'
        ? Number(difficulty) || 0
        : 0;
    record.params.hasImage = Boolean(image);
    record.params.hasAnswerImage = Boolean(answerImage);
  });
  return response;
}

async function addGameDetails<T extends EnrichedResponse>(
  response: T,
): Promise<T> {
  const records = responseRecords(response);
  const ids = records
    .map((record) => numericParam(record, 'id'))
    .filter(Number.isFinite);
  if (!ids.length) return response;

  const [games, categoryLinks] = await Promise.all([
    GameEntity.findBy({ id: In(ids) }),
    GameCategoryEntity.find({
      where: { gameId: In(ids) },
      relations: { category: true },
    }),
  ]);
  const gamesById = new Map(games.map((game) => [Number(game.id), game]));
  const categoriesByGame = new Map<number, string[]>();
  categoryLinks.forEach((link) => {
    const names = categoriesByGame.get(Number(link.gameId)) || [];
    names.push(link.category?.name || String(link.categoryId));
    categoriesByGame.set(Number(link.gameId), names);
  });

  records.forEach((record) => {
    const id = numericParam(record, 'id');
    const game = gamesById.get(id);
    record.params.teamCount = Array.isArray(game?.teams)
      ? game.teams.length
      : 0;
    record.params.categoryNames = (categoriesByGame.get(id) || []).join(', ');
  });
  return response;
}

const resources: ResourceWithOptions[] = [
  {
    resource: UserEntity,
    options: {
      navigation: { name: 'Accounts', icon: 'User' },
      titleProperty: 'username',
      listProperties: [
        'id',
        'username',
        'email',
        'firstName',
        'lastName',
        'isStaff',
        'isActive',
        'profileIsPremium',
      ],
      showProperties: [
        'id',
        'username',
        'email',
        'firstName',
        'lastName',
        'lastLogin',
        'isActive',
        'isStaff',
        'isSuperuser',
        'dateJoined',
        'profileAvatar',
        'profileBio',
        'profileIsPremium',
        'profilePremiumExpiry',
      ],
      editProperties: [
        'username',
        'email',
        'firstName',
        'lastName',
        'isActive',
        'isStaff',
        'isSuperuser',
      ],
      filterProperties: [
        'id',
        'username',
        'email',
        'isActive',
        'isStaff',
        'isSuperuser',
        'dateJoined',
        'lastLogin',
      ],
      properties: {
        password: { isVisible: false },
        profile: { isVisible: false },
        profileAvatar: {
          type: 'string',
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        profileBio: {
          type: 'textarea',
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        profileIsPremium: {
          type: 'boolean',
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        profilePremiumExpiry: {
          type: 'date',
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        new: { isAccessible: false },
        delete: {
          isAccessible: ({ currentAdmin }) =>
            currentAdmin?.title === 'Superuser',
        },
        bulkDelete: {
          isAccessible: ({ currentAdmin }) =>
            currentAdmin?.title === 'Superuser',
        },
        list: { after: addUserDetailsAndStrip },
        show: { after: addUserDetailsAndStrip },
        search: { after: stripSensitiveUserResponse },
        edit: {
          before: restrictUserWritePayload,
          after: stripSensitiveUserResponse,
        },
      },
    },
  },
  {
    resource: UserProfileEntity,
    options: {
      navigation: { name: 'Accounts', icon: 'User' },
      titleProperty: 'userId',
      listProperties: [
        'id',
        'userUsername',
        'userEmail',
        'avatar',
        'userId',
        'isPremium',
        'premiumExpiry',
        'dateUpdated',
      ],
      showProperties: [
        'id',
        'userId',
        'userUsername',
        'userEmail',
        'avatar',
        'bio',
        'isPremium',
        'premiumExpiry',
        'dateUpdated',
      ],
      editProperties: ['userId', 'avatar', 'bio', 'isPremium', 'premiumExpiry'],
      filterProperties: ['userId', 'isPremium', 'dateUpdated'],
      properties: {
        user: { isVisible: false },
        userUsername: {
          type: 'string',
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        userEmail: {
          type: 'string',
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
      },
      actions: {
        new: { isAccessible: false },
        list: { after: addProfileDetails },
        show: { after: addProfileDetails },
        edit: { before: restrictProfileWritePayload },
      },
    },
  },
  {
    resource: CollectionEntity,
    options: {
      navigation: { name: 'Trivia Content', icon: 'BookOpen' },
      titleProperty: 'name',
      listProperties: ['id', 'name', 'order'],
      showProperties: ['id', 'name', 'order'],
      editProperties: ['name', 'order'],
      filterProperties: ['id', 'name', 'order'],
      sort: { sortBy: 'order', direction: 'asc' },
      properties: {
        categories: { isVisible: false },
      },
      actions: {
        new: { before: collectionWritePayload },
        edit: { before: collectionWritePayload },
      },
    },
  },
  {
    resource: CategoryEntity,
    options: {
      navigation: { name: 'Trivia Content', icon: 'BookOpen' },
      titleProperty: 'name',
      listProperties: [
        'id',
        'name',
        'isHidden',
        'locked',
        'isCustom',
        'isApproved',
        'createdById',
        'privacy',
        'collectionId',
        'likesCount',
        'createdAt',
      ],
      showProperties: [
        'id',
        'name',
        'description',
        'image',
        'collectionId',
        'locked',
        'isHidden',
        'isCustom',
        'isApproved',
        'privacy',
        'createdById',
        'likesCount',
        'createdAt',
        'updatedAt',
      ],
      editProperties: [
        'name',
        'description',
        'image',
        'collectionId',
        'locked',
        'isHidden',
        'isCustom',
        'isApproved',
        'privacy',
        'createdById',
      ],
      filterProperties: [
        'id',
        'name',
        'collectionId',
        'isCustom',
        'isApproved',
        'locked',
        'isHidden',
        'privacy',
      ],
      sort: { sortBy: 'createdAt', direction: 'desc' },
      properties: {
        collection: { isVisible: false },
        createdBy: { isVisible: false },
        questions: { isVisible: false },
        createdById: {},
        collectionId: {},
        isHidden: {},
        isCustom: {},
        isApproved: {},
        likesCount: {
          type: 'number',
          isSortable: false,
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        privacy: {
          availableValues: [
            { value: 'public', label: 'Public' },
            { value: 'private', label: 'Private' },
          ],
        },
      },
      actions: {
        list: { after: addCategoryDetails },
        show: { after: addCategoryDetails },
        new: { before: categoryWritePayload },
        edit: { before: categoryWritePayload },
      },
    },
  },
  {
    resource: QuestionEntity,
    options: {
      navigation: { name: 'Trivia Content', icon: 'BookOpen' },
      titleProperty: 'text',
      listProperties: [
        'id',
        'text',
        'answer',
        'categoryId',
        'difficulty',
        'points',
        'hasImage',
        'hasAnswerImage',
      ],
      showProperties: [
        'id',
        'categoryId',
        'text',
        'textAr',
        'answer',
        'answerAr',
        'choice2',
        'choice3',
        'choice4',
        'difficulty',
        'points',
        'image',
        'answerImage',
        'hasImage',
        'hasAnswerImage',
        'imageHash',
        'answerImageHash',
        'randomKey',
      ],
      editProperties: [
        'categoryId',
        'text',
        'textAr',
        'answer',
        'answerAr',
        'choice2',
        'choice3',
        'choice4',
        'difficulty',
        'image',
        'answerImage',
        'randomKey',
      ],
      filterProperties: [
        'id',
        'categoryId',
        'difficulty',
        'image',
        'answerImage',
      ],
      properties: {
        category: { isVisible: false },
        categoryId: {},
        difficulty: {
          availableValues: [
            { value: '200', label: '200' },
            { value: '400', label: '400' },
            { value: '600', label: '600' },
          ],
        },
        points: {
          type: 'number',
          isSortable: false,
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        hasImage: {
          type: 'boolean',
          isSortable: false,
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        hasAnswerImage: {
          type: 'boolean',
          isSortable: false,
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        imageHash: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        answerImageHash: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        list: { after: addQuestionDetails },
        show: { after: addQuestionDetails },
        edit: { before: questionWritePayload },
      },
    },
  },
  {
    resource: SavedCategoryEntity,
    options: {
      navigation: { name: 'Engagement', icon: 'Heart' },
      titleProperty: 'id',
      listProperties: ['id', 'userId', 'categoryId', 'savedAt'],
      showProperties: ['id', 'userId', 'categoryId', 'savedAt'],
      filterProperties: ['id', 'userId', 'categoryId', 'savedAt'],
      sort: { sortBy: 'savedAt', direction: 'desc' },
      properties: {
        user: { isVisible: false },
        category: { isVisible: false },
        userId: {},
        categoryId: {},
      },
      actions: readOnlyActions,
    },
  },
  {
    resource: CategoryLikeEntity,
    options: {
      navigation: { name: 'Engagement', icon: 'Heart' },
      titleProperty: 'id',
      listProperties: ['id', 'userId', 'categoryId', 'createdAt'],
      showProperties: ['id', 'userId', 'categoryId', 'createdAt'],
      filterProperties: ['id', 'userId', 'categoryId', 'createdAt'],
      sort: { sortBy: 'createdAt', direction: 'desc' },
      properties: {
        user: { isVisible: false },
        category: { isVisible: false },
        userId: {},
        categoryId: {},
      },
      actions: readOnlyActions,
    },
  },
  {
    resource: GameEntity,
    options: {
      navigation: { name: 'Gameplay', icon: 'GameController' },
      titleProperty: 'id',
      listProperties: ['id', 'playerId', 'mode', 'datePlayed', 'teamCount'],
      showProperties: [
        'id',
        'playerId',
        'mode',
        'teams',
        'teamCount',
        'categoryNames',
        'datePlayed',
      ],
      filterProperties: ['id', 'playerId', 'mode', 'datePlayed'],
      sort: { sortBy: 'datePlayed', direction: 'desc' },
      properties: {
        player: { isVisible: false },
        categoryLinks: { isVisible: false },
        playedQuestions: { isVisible: false },
        playerId: {},
        mode: {
          availableValues: [
            { value: 'offline', label: 'Offline' },
            { value: 'solo', label: 'Solo' },
            { value: 'online', label: 'Online' },
          ],
        },
        teamCount: {
          type: 'number',
          isSortable: false,
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        categoryNames: {
          type: 'string',
          isSortable: false,
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        ...readOnlyActions,
        list: { after: addGameDetails },
        show: { after: addGameDetails },
      },
    },
  },
  {
    resource: GameCategoryEntity,
    options: {
      navigation: { name: 'Gameplay', icon: 'GameController' },
      titleProperty: 'id',
      listProperties: ['id', 'gameId', 'categoryId'],
      showProperties: ['id', 'gameId', 'categoryId'],
      filterProperties: ['id', 'gameId', 'categoryId'],
      properties: {
        game: { isVisible: false },
        category: { isVisible: false },
        gameId: {},
        categoryId: {},
      },
      actions: readOnlyActions,
    },
  },
  {
    resource: PlayedQuestionEntity,
    options: {
      navigation: { name: 'Gameplay', icon: 'GameController' },
      titleProperty: 'id',
      listProperties: ['gameId', 'questionId'],
      showProperties: ['id', 'gameId', 'questionId'],
      filterProperties: ['id', 'gameId', 'questionId'],
      properties: {
        game: { isVisible: false },
        question: { isVisible: false },
        gameId: {},
        questionId: {},
      },
      actions: readOnlyActions,
    },
  },
  {
    resource: PaymentEntity,
    options: {
      navigation: { name: 'Billing', icon: 'CreditCard' },
      titleProperty: 'orderId',
      listProperties: [
        'userId',
        'orderId',
        'amount',
        'amountMinor',
        'currency',
        'status',
        'paidAt',
        'createdAt',
      ],
      showProperties: [
        'id',
        'userId',
        'orderId',
        'customerId',
        'amount',
        'amountMinor',
        'currency',
        'status',
        'variantId',
        'productName',
        'paidAt',
        'createdAt',
        'updatedAt',
        'webhookData',
      ],
      filterProperties: ['id', 'userId', 'status', 'currency', 'createdAt'],
      sort: { sortBy: 'createdAt', direction: 'desc' },
      properties: {
        user: { isVisible: false },
        userId: {},
        status: {
          availableValues: [
            { value: 'pending', label: 'Pending' },
            { value: 'paid', label: 'Paid' },
            { value: 'failed', label: 'Failed' },
            { value: 'refunded', label: 'Refunded' },
          ],
        },
        webhookData: {
          isVisible: { list: false, filter: false, show: true, edit: false },
        },
      },
      actions: readOnlyActions,
    },
  },
  {
    resource: SubscriptionEntity,
    options: {
      navigation: { name: 'Billing', icon: 'CreditCard' },
      titleProperty: 'subscriptionId',
      listProperties: [
        'userId',
        'subscriptionId',
        'status',
        'renewsAt',
        'createdAt',
      ],
      showProperties: [
        'id',
        'userId',
        'subscriptionId',
        'customerId',
        'orderId',
        'variantId',
        'productName',
        'status',
        'trialEndsAt',
        'renewsAt',
        'endsAt',
        'createdAt',
        'updatedAt',
      ],
      filterProperties: ['id', 'userId', 'status', 'createdAt'],
      sort: { sortBy: 'createdAt', direction: 'desc' },
      properties: {
        user: { isVisible: false },
        userId: {},
        status: {
          availableValues: [
            { value: 'on_trial', label: 'On Trial' },
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'past_due', label: 'Past Due' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'expired', label: 'Expired' },
          ],
        },
      },
      actions: readOnlyActions,
    },
  },
];

export async function setupAdmin(app: NestExpressApplication): Promise<void> {
  const config = app.get(ConfigService);
  const dataSource = app.get(DataSource);
  const passwords = app.get(PasswordService);
  const media = app.get(MediaService);
  const cookieSecret =
    config.get<string>('ADMIN_COOKIE_SECRET') ||
    config.get<string>('APP_SECRET');
  if (!cookieSecret)
    throw new Error('ADMIN_COOKIE_SECRET or APP_SECRET must be configured');

  const [adminJsModule, typeormModule, expressModule] = await Promise.all([
    nativeImport('adminjs') as Promise<typeof import('adminjs')>,
    nativeImport('@adminjs/typeorm') as Promise<TypeOrmAdapterModule>,
    nativeImport('@adminjs/express') as Promise<
      typeof import('@adminjs/express')
    >,
  ]);

  const AdminJS = adminJsModule.default;
  const componentLoader = new adminJsModule.ComponentLoader();
  const mediaPreviewPath =
    config.get('NODE_ENV') === 'production'
      ? resolve(__dirname, 'components', 'media-preview')
      : resolve(process.cwd(), 'src', 'admin', 'components', 'media-preview');
  const mediaPreview = componentLoader.add('MediaPreview', mediaPreviewPath);
  const { Database, Resource } = typeormModule;
  Resource.validate = async (object) => {
    if (!object || typeof object !== 'object') return Promise.resolve([]);
    const classValidatorErrors = await validate(object, {
      forbidUnknownValues: false,
    });
    return [...classValidatorErrors, ...validateAdminEntity(object)];
  };
  AdminJS.registerAdapter({ Database, Resource });

  const mediaProperties = new Map<unknown, string[]>([
    [UserEntity, ['profileAvatar']],
    [UserProfileEntity, ['avatar']],
    [CategoryEntity, ['image']],
    [QuestionEntity, ['image', 'answerImage']],
  ]);
  const mediaBaseUrl = (
    config.get<string>('CLOUDFLARE_R2_CUSTOM_DOMAIN') ||
    config.get<string>('CLOUDFLARE_R2_PUBLIC_URL') ||
    config.get<string>('MEDIA_PUBLIC_URL') ||
    `http://localhost:${config.get('PORT', 8000)}/media`
  ).replace(/\/$/, '');
  resources.forEach((resource) => {
    const propertyNames = mediaProperties.get(resource.resource);
    if (!propertyNames) return;
    resource.options.properties ||= {};
    propertyNames.forEach((propertyName) => {
      const property = (resource.options.properties![propertyName] ||= {});
      property.components = { ...property.components, show: mediaPreview };
      property.custom = {
        ...property.custom,
        mediaBaseUrl,
      };
    });
  });

  const admin = new AdminJS({
    rootPath: '/admin',
    resources,
    componentLoader,
    branding: {
      companyName: 'TriviaSpirit Admin',
      logo: false,
      withMadeWithLove: false,
    },
    settings: {
      defaultPerPage: 20,
    },
  });
  if (config.get('NODE_ENV') !== 'production') await admin.watch();

  const authenticate = async (
    email: string,
    password: string,
  ): Promise<CurrentAdmin | null> => {
    const user = await UserEntity.findOne({
      where: {
        email: Raw((column) => `LOWER(${column}) = :normalizedEmail`, {
          normalizedEmail: email.trim().toLowerCase(),
        }),
      },
      relations: { profile: true },
    });
    if (
      !user ||
      !user.isActive ||
      (!user.isStaff && !user.isSuperuser) ||
      !(await passwords.verify(password, user.password))
    ) {
      return null;
    }

    return {
      id: String(user.id),
      email: user.email,
      title: user.isSuperuser ? 'Superuser' : 'Staff',
      avatarUrl: media.url(user.profile?.avatar) || undefined,
      sessionVersion: user.sessionVersion || 0,
    };
  };

  const sessionOptions = {
    secret: cookieSecret,
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore(dataSource),
    cookie: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: config.get('NODE_ENV') === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
  };
  const predefinedRouter = Router();
  predefinedRouter.use(session(sessionOptions));
  predefinedRouter.use(async (request, response, next) => {
    const adminUser = (request.session as Session & { adminUser?: unknown })
      .adminUser as
      { id?: string | number; sessionVersion?: number } | undefined;
    if (!adminUser?.id) {
      next();
      return;
    }
    try {
      const user = await dataSource.getRepository(UserEntity).findOneBy({
        id: Number(adminUser.id),
      });
      if (
        !user ||
        !user.isActive ||
        (!user.isStaff && !user.isSuperuser) ||
        (adminUser.sessionVersion ?? -1) !== (user.sessionVersion || 0)
      ) {
        request.session.destroy(() => response.redirect('/admin/login'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  const adminRouter = expressModule.buildAuthenticatedRouter(
    admin,
    {
      authenticate,
      cookieName: 'triviaspirit-admin',
      cookiePassword: cookieSecret,
      maxRetries: { count: 5, duration: 60 },
    },
    predefinedRouter,
    sessionOptions,
  );

  app.use(admin.options.rootPath, adminRouter);
}
