import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { PasswordService } from '../src/auth/password.service';
import {
  AuthRateLimitEntity,
  AuthTokenEntity,
  CategoryEntity,
  PaymentEntity,
  PaymentWebhookEventEntity,
  QuestionEntity,
  UserEntity,
  UserProfileEntity,
} from '../src/database/entities';

const integrationDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;

function assertDisposableIntegrationDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(
    parsed.hostname.toLowerCase(),
  );
  if (
    process.env.TEST_DATABASE_DISPOSABLE !== 'true' &&
    (!localHost || !/(test|ci)/.test(databaseName))
  ) {
    throw new Error(
      'TEST_DATABASE_URL must point to a local disposable test/ci database, or set TEST_DATABASE_DISPOSABLE=true explicitly.',
    );
  }
}

const DJANGO_PASSWORD_HASH =
  'pbkdf2_sha256$1000$django-test-salt$M7rP4cqQe+Y9ApVkWYW925+5bVLBDM0P/321uifgVxE=';

integrationDescribe('TriviaSpirit API compatibility (e2e)', () => {
  let app: import('@nestjs/common').INestApplication;
  let database: DataSource;
  let passwords: PasswordService;
  let firstUser: { id: number; token: string };
  let secondUser: { id: number; token: string };
  let gameId: number;
  let gameQuestionId: number;

  beforeAll(async () => {
    assertDisposableIntegrationDatabase(integrationDatabaseUrl!);
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.DATABASE_SSL = 'false';
    process.env.DATABASE_SYNCHRONIZE = 'true';
    process.env.DATABASE_MIGRATIONS_RUN = 'false';
    process.env.APP_SECRET = 'integration-test-application-secret';
    process.env.PBKDF2_ITERATIONS = '1000';
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'integration-webhook-secret';
    process.env.LEMONSQUEEZY_API_KEY = 'integration-test-api-key';
    process.env.LEMONSQUEEZY_STORE_ID = 'integration-test-store';
    process.env.LEMONSQUEEZY_VARIANT_ID = 'variant-1';
    process.env.LEMONSQUEEZY_TEST_MODE = 'true';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    const express = app.getHttpAdapter().getInstance() as {
      set(name: string, value: number): void;
    };
    express.set('trust proxy', 1);
    await app.init();
    database = app.get(DataSource);
    passwords = app.get(PasswordService);
    await database.runMigrations();
  });

  afterAll(async () => {
    if (database?.isInitialized) await database.dropDatabase();
    if (app) await app.close();
  });

  it('exposes the health contract', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', service: 'triviaspirit-nestjs-backend' });
  });

  it('mounts every route used by the Next.js API clients', async () => {
    for (const path of [
      '/api/content/collections/all_data/',
      '/api/content/categories/',
    ]) {
      await request(app.getHttpServer()).get(path).expect(200);
    }

    const protectedGets = [
      '/api/auth/profile/',
      '/api/gameplay/games/',
      '/api/gameplay/games/1/',
      '/api/gameplay/games/1/available_questions/',
      '/api/gameplay/games/1/prefetch_outside_board/?count=4',
      '/api/gameplay/stats/',
      '/api/gameplay/recent/',
      '/api/content/user-categories/',
      '/api/content/user-categories/1/',
      '/api/content/user-categories/my_categories/',
      '/api/content/user-categories/my_saved_categories/',
      '/api/payments/history/',
    ];
    for (const path of protectedGets) {
      await request(app.getHttpServer()).get(path).expect(401);
    }

    const protectedPosts = [
      '/api/gameplay/games/',
      '/api/gameplay/games/1/finish_round/',
      '/api/content/questions/',
      '/api/content/user-categories/',
      '/api/content/user-categories/1/add_questions/',
      '/api/content/user-categories/1/add_to_collection/',
      '/api/content/user-categories/1/remove_from_collection/',
      '/api/content/user-categories/1/like/',
      '/api/content/user-categories/1/unlike/',
      '/api/payments/checkout/',
      '/api/auth/logout/',
    ];
    for (const path of protectedPosts) {
      await request(app.getHttpServer()).post(path).send({}).expect(401);
    }

    await request(app.getHttpServer())
      .patch('/api/auth/profile/update/')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/auth/profile/avatar/')
      .expect(401);
    await request(app.getHttpServer())
      .put('/api/content/questions/1/')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/content/user-categories/1/')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .delete('/api/content/questions/1/')
      .expect(401);
    await request(app.getHttpServer())
      .delete('/api/content/user-categories/1/')
      .expect(401);
  });

  it('validates registration and preserves login response compatibility', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'invalid', password: 'short' })
      .expect(400);

    const first = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'owner@example.com',
        password: 'InitialPass123',
        username: 'owner',
        first_name: 'Owner',
      })
      .expect(201);
    firstUser = {
      id: first.body.user.id as number,
      token: first.body.token as string,
    };
    expect(first.body).toEqual({
      token: expect.stringMatching(/^[a-f\d]{40}$/),
      user: expect.objectContaining({
        id: firstUser.id,
        username: 'owner',
        email: 'owner@example.com',
        is_premium: false,
      }),
    });

    const second = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'other@example.com',
        password: 'InitialPass123',
        username: 'other',
      })
      .expect(201);
    secondUser = {
      id: second.body.user.id as number,
      token: second.body.token as string,
    };

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'OWNER@example.com', password: 'InitialPass123' })
      .expect(200);
    expect(login.body.token).toBe(firstUser.token);

    await request(app.getHttpServer()).get('/api/auth/profile').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/google-oauth')
      .send({ token: '' })
      .expect(400);
  });

  it('reads Django table/password/token records without conversion', async () => {
    const userRepository = database.getRepository(UserEntity);
    const profileRepository = database.getRepository(UserProfileEntity);
    const tokenRepository = database.getRepository(AuthTokenEntity);
    const djangoUser = await userRepository.save(
      userRepository.create({
        username: 'django-user',
        email: 'django@example.com',
        password: DJANGO_PASSWORD_HASH,
        firstName: 'Django',
        lastName: 'Compatible',
        isActive: true,
        isStaff: false,
        isSuperuser: false,
      }),
    );
    await profileRepository.save(
      profileRepository.create({
        userId: djangoUser.id,
        avatar: null,
        bio: '',
        isPremium: false,
        premiumExpiry: null,
      }),
    );
    const djangoToken = 'd'.repeat(40);
    await tokenRepository.save(
      tokenRepository.create({ key: djangoToken, userId: djangoUser.id }),
    );

    expect(userRepository.metadata.tableName).toBe('auth_user');
    expect(tokenRepository.metadata.tableName).toBe('authtoken_token');
    await request(app.getHttpServer())
      .get('/api/auth/profile')
      .set('Authorization', `Token ${djangoToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user.email).toBe('django@example.com');
      });
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'django@example.com', password: 'DjangoPass123' })
      .expect(200)
      .expect(({ body }) => expect(body.token).toBe(djangoToken));
  });

  it('enforces category ownership and hides private category content', async () => {
    const categories = database.getRepository(CategoryEntity);
    const questions = database.getRepository(QuestionEntity);
    const privateCategory = await categories.save(
      categories.create({
        name: 'Private set',
        description: 'Owner only',
        image: null,
        collectionId: null,
        isCustom: true,
        isApproved: true,
        isHidden: false,
        locked: false,
        privacy: 'private',
        createdById: firstUser.id,
      }),
    );
    const privateQuestion = await questions.save(
      questions.create({
        categoryId: privateCategory.id,
        text: 'Private question',
        textAr: '',
        answer: 'Private answer',
        answerAr: '',
        choice2: null,
        choice3: null,
        choice4: null,
        image: null,
        answerImage: null,
        imageHash: null,
        answerImageHash: null,
        difficulty: '200',
        randomKey: 0.1,
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/content/questions/${privateQuestion.id}`)
      .set('Authorization', `Token ${secondUser.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/content/questions/${privateQuestion.id}`)
      .set('Authorization', `Token ${firstUser.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/content/questions/${privateQuestion.id}`)
      .set('Authorization', `Token ${secondUser.token}`)
      .send({ text: 'stolen edit' })
      .expect(403);
  });

  it('accepts the frontend multipart category and question contracts', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/content/user-categories/')
      .set('Authorization', `Token ${firstUser.token}`)
      .field('name', 'Frontend category')
      .field('description', 'Created with FormData')
      .field('privacy', 'private')
      .expect(201);
    const categoryId = created.body.category.id as number;
    expect(created.body.category).toEqual(
      expect.objectContaining({
        id: categoryId,
        name: 'Frontend category',
        privacy: 'private',
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/content/user-categories/${categoryId}/add_questions/`)
      .set('Authorization', `Token ${firstUser.token}`)
      .field('questions[0][text]', 'Bracket notation question')
      .field('questions[0][answer]', 'Bracket notation answer')
      .field('questions[0][points]', '400')
      .expect(201)
      .expect(({ body }) => expect(body.category.questions_count).toBe(1));

    const directQuestion = await request(app.getHttpServer())
      .post('/api/content/questions/')
      .set('Authorization', `Token ${firstUser.token}`)
      .field('text', 'Direct question')
      .field('answer', 'Direct answer')
      .field('points', '200')
      .field('category', String(categoryId))
      .expect(201);
    expect(directQuestion.body).toEqual(
      expect.objectContaining({
        text: 'Direct question',
        answer: 'Direct answer',
        points: 200,
      }),
    );

    await request(app.getHttpServer())
      .put(`/api/content/questions/${directQuestion.body.id as number}/`)
      .set('Authorization', `Token ${firstUser.token}`)
      .field('text', 'Updated direct question')
      .expect(200)
      .expect(({ body }) => expect(body.text).toBe('Updated direct question'));
  });

  it('creates owned games and validates round questions against the board', async () => {
    const categories = database.getRepository(CategoryEntity);
    const questions = database.getRepository(QuestionEntity);
    const category = await categories.save(
      categories.create({
        name: 'Official category',
        description: 'Public',
        image: null,
        collectionId: null,
        isCustom: false,
        isApproved: true,
        isHidden: false,
        locked: false,
        privacy: 'public',
        createdById: null,
      }),
    );
    const createdQuestions = await questions.save(
      [0, 1, 2, 3, 4, 5].map((index) =>
        questions.create({
          categoryId: category.id,
          text: `Question ${index}`,
          textAr: '',
          answer: `Answer ${index}`,
          answerAr: '',
          choice2: null,
          choice3: null,
          choice4: null,
          image: null,
          answerImage: null,
          imageHash: null,
          answerImageHash: null,
          difficulty: ['200', '400', '600'][index % 3],
          randomKey: index / 10,
        }),
      ),
    );
    gameQuestionId = Number(createdQuestions[0].id);

    const created = await request(app.getHttpServer())
      .post('/api/gameplay/games')
      .set('Authorization', `Token ${firstUser.token}`)
      .send({
        category_ids: [Number(category.id)],
        mode: 'offline',
        team_names: ['Blue', 'Red'],
      })
      .expect(201);
    gameId = created.body.id as number;
    expect(created.body).toEqual(
      expect.objectContaining({
        id: gameId,
        mode: 'offline',
        teams: [
          { id: 1, name: 'Blue', avatar: 'cat' },
          { id: 2, name: 'Red', avatar: 'cat' },
        ],
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/gameplay/games/${gameId}`)
      .set('Authorization', `Token ${secondUser.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/gameplay/games/${gameId}/finish_round`)
      .set('Authorization', `Token ${firstUser.token}`)
      .send({ played_question_ids: [gameQuestionId] })
      .expect(200)
      .expect({ status: 'ok', saved: 1 });
    await request(app.getHttpServer())
      .post(`/api/gameplay/games/${gameId}/finish_round`)
      .set('Authorization', `Token ${firstUser.token}`)
      .send({ played_question_ids: [gameQuestionId] })
      .expect(200)
      .expect({ status: 'ok', saved: 0 });

    const outsiderCategory = await categories.save(
      categories.create({
        name: 'Other official category',
        description: '',
        image: null,
        collectionId: null,
        isCustom: false,
        isApproved: true,
        isHidden: false,
        locked: false,
        privacy: 'public',
        createdById: null,
      }),
    );
    const outsiderQuestion = await questions.save(
      questions.create({
        categoryId: outsiderCategory.id,
        text: 'Outside board',
        textAr: '',
        answer: 'No',
        answerAr: '',
        difficulty: '200',
        randomKey: 0.5,
      }),
    );
    await request(app.getHttpServer())
      .post(`/api/gameplay/games/${gameId}/finish_round`)
      .set('Authorization', `Token ${firstUser.token}`)
      .send({ played_question_ids: [Number(outsiderQuestion.id)] })
      .expect(400);
  });

  it('rotates tokens after password changes/resets and revokes logout tokens', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/password-reset-confirm')
      .send({
        uid: 'not-a-user',
        token: 'invalid-reset-token',
        new_password: 'ResetPass123',
      })
      .expect(400);

    const changed = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Token ${firstUser.token}`)
      .send({
        current_password: 'InitialPass123',
        new_password: 'ChangedPass123',
      })
      .expect(200);
    const changedToken = changed.body.token as string;
    expect(changedToken).not.toBe(firstUser.token);
    await request(app.getHttpServer())
      .get('/api/auth/profile')
      .set('Authorization', `Token ${firstUser.token}`)
      .expect(401);

    const user = await database
      .getRepository(UserEntity)
      .findOneByOrFail({ id: firstUser.id });
    const resetToken = passwords.makeResetToken(user.id, user.password);
    const uid = Buffer.from(String(user.id)).toString('base64url');
    await request(app.getHttpServer())
      .post('/api/auth/password-reset-confirm')
      .send({ uid, token: resetToken, new_password: 'ResetPass123' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/profile')
      .set('Authorization', `Token ${changedToken}`)
      .expect(401);

    const resetRaceUser = await database
      .getRepository(UserEntity)
      .findOneByOrFail({ id: firstUser.id });
    const resetRaceToken = passwords.makeResetToken(
      resetRaceUser.id,
      resetRaceUser.password,
    );
    const resetRaceUid = Buffer.from(String(resetRaceUser.id)).toString(
      'base64url',
    );
    const resetRaceResponses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/password-reset-confirm')
        .send({
          uid: resetRaceUid,
          token: resetRaceToken,
          new_password: 'RacePass123',
        }),
      request(app.getHttpServer())
        .post('/api/auth/password-reset-confirm')
        .send({
          uid: resetRaceUid,
          token: resetRaceToken,
          new_password: 'RacePass123',
        }),
    ]);
    expect(
      resetRaceResponses.map((response) => response.status).sort(),
    ).toEqual([200, 400]);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: 'RacePass123' })
      .expect(200);
    const resetLoginToken = login.body.token as string;
    expect(resetLoginToken).not.toBe(changedToken);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Token ${resetLoginToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/profile')
      .set('Authorization', `Token ${resetLoginToken}`)
      .expect(401);
  });

  it('rejects unsigned webhooks in every environment and handles replay once', async () => {
    const payload = JSON.stringify({
      meta: {
        event_name: 'order_created',
        custom_data: { user_id: String(firstUser.id) },
      },
      data: {
        id: 'integration-order-1',
        type: 'orders',
        attributes: {
          customer_id: 'customer-1',
          total: 1499,
          currency: 'USD',
          status: 'paid',
          test_mode: true,
          updated_at: '2026-09-22T00:00:00.000Z',
          first_order_item: {
            variant_id: 'variant-1',
            product_name: 'Premium',
          },
        },
      },
    });
    const signature = createHmac('sha256', 'integration-webhook-secret')
      .update(payload)
      .digest('hex');

    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-signature', '0'.repeat(64))
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-signature', signature)
      .send(payload)
      .expect(201)
      .expect({ status: 'success' });
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-signature', signature)
      .send(payload)
      .expect(201)
      .expect({ status: 'duplicate' });

    expect(await database.getRepository(PaymentEntity).count()).toBe(1);
    const payment = await database
      .getRepository(PaymentEntity)
      .findOneByOrFail({ orderId: 'integration-order-1' });
    expect(payment.amount).toBe('14.99');
    expect(payment.amountMinor).toBe(1499);
    expect(
      await database.getRepository(PaymentWebhookEventEntity).count(),
    ).toBe(1);
    const profile = await database
      .getRepository(UserProfileEntity)
      .findOneByOrFail({ userId: firstUser.id });
    expect(profile.isPremium).toBe(true);
  });

  it('validates checkout DTOs before contacting the provider', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/checkout')
      .set('Authorization', `Token ${secondUser.token}`)
      .send({ plan: 'attacker-controlled-plan' })
      .expect(400);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('provider unavailable'));
    await request(app.getHttpServer())
      .post('/api/payments/checkout')
      .set('Authorization', `Token ${secondUser.token}`)
      .send({ plan: 'premium' })
      .expect(503);
    fetchSpy.mockRestore();
  });

  it('durably throttles repeated login attempts by account', async () => {
    await database.getRepository(AuthRateLimitEntity).clear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'target@example.com', password: 'WrongPass123' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'target@example.com', password: 'WrongPass123' })
      .expect(429);
    expect(await database.getRepository(AuthRateLimitEntity).count()).toBe(2);
  });
});
