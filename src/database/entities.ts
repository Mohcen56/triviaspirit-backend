import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('auth_user')
export class UserEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'varchar', length: 128 })
  password: string;

  @Column({ name: 'last_login', type: 'timestamptz', nullable: true })
  lastLogin: Date | null;

  @Column({ name: 'is_superuser', default: false })
  isSuperuser: boolean;

  @Column({ type: 'varchar', length: 150, unique: true })
  username: string;

  @Column({ name: 'first_name', type: 'varchar', length: 150, default: '' })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 150, default: '' })
  lastName: string;

  @Index()
  @Column({ type: 'varchar', length: 254, default: '' })
  email: string;

  @Column({ name: 'is_staff', default: false })
  isStaff: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'date_joined', type: 'timestamptz' })
  dateJoined: Date;

  @OneToOne(() => UserProfileEntity, (profile) => profile.user)
  profile?: Relation<UserProfileEntity>;
}

@Entity('authentication_userprofile')
export class UserProfileEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  avatar: string | null;

  @Column({ type: 'text', default: '' })
  bio: string;

  @UpdateDateColumn({ name: 'date_updated', type: 'timestamptz' })
  dateUpdated: Date;

  @Column({ name: 'user_id', type: 'integer', unique: true })
  userId: number;

  @OneToOne(() => UserEntity, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;

  @Column({ name: 'is_premium', default: false })
  isPremium: boolean;

  @Column({ name: 'premium_expiry', type: 'date', nullable: true })
  premiumExpiry: string | null;
}

@Entity('authtoken_token')
export class AuthTokenEntity extends BaseEntity {
  @PrimaryColumn({ name: 'key', type: 'varchar', length: 40 })
  key: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created: Date;

  @Column({ name: 'user_id', type: 'integer', unique: true })
  userId: number;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;
}

@Entity('content_collection')
export class CollectionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'order', type: 'integer', default: 0 })
  order: number;

  @OneToMany(() => CategoryEntity, (category) => category.collection)
  categories?: Relation<CategoryEntity[]>;
}

@Entity('content_category')
@Index(['isCustom', 'isApproved', 'privacy'])
@Index(['createdById', 'createdAt'])
export class CategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ default: false })
  locked: boolean;

  @Column({ name: 'is_hidden', default: false })
  isHidden: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  image: string | null;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'collection_id', type: 'bigint', nullable: true })
  collectionId: number | null;

  @ManyToOne(() => CollectionEntity, (collection) => collection.categories, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'collection_id' })
  collection?: Relation<CollectionEntity> | null;

  @Column({ name: 'is_custom', default: false })
  isCustom: boolean;

  @Column({ name: 'created_by_id', type: 'integer', nullable: true })
  createdById: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<UserEntity> | null;

  @Column({ name: 'is_approved', default: false })
  isApproved: boolean;

  @Column({ type: 'varchar', length: 10, default: 'public' })
  privacy: 'public' | 'private';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', nullable: true })
  createdAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt: Date | null;

  @OneToMany(() => QuestionEntity, (question) => question.category)
  questions?: Relation<QuestionEntity[]>;
}

@Entity('content_question')
@Index(['categoryId', 'difficulty'])
@Index(['categoryId', 'randomKey'])
export class QuestionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'category_id', type: 'bigint' })
  categoryId: number;

  @ManyToOne(() => CategoryEntity, (category) => category.questions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id' })
  category: Relation<CategoryEntity>;

  @Column({ type: 'text' })
  text: string;

  @Column({ name: 'text_ar', type: 'text', default: '' })
  textAr: string;

  @Column({ type: 'varchar', length: 200 })
  answer: string;

  @Column({ name: 'choice_2', type: 'varchar', length: 255, nullable: true })
  choice2: string | null;

  @Column({ name: 'choice_3', type: 'varchar', length: 255, nullable: true })
  choice3: string | null;

  @Column({ name: 'choice_4', type: 'varchar', length: 255, nullable: true })
  choice4: string | null;

  @Column({ name: 'answer_ar', type: 'varchar', length: 200, default: '' })
  answerAr: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  image: string | null;

  @Column({
    name: 'answer_image',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  answerImage: string | null;

  @Column({ name: 'image_hash', type: 'varchar', length: 64, nullable: true })
  imageHash: string | null;

  @Column({
    name: 'answer_image_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  answerImageHash: string | null;

  @Column({ type: 'varchar', length: 20, default: '200' })
  difficulty: string;

  @Column({ name: 'random_key', type: 'double precision', default: 0.5 })
  randomKey: number;
}

@Entity('content_savedcategory')
@Unique(['userId', 'categoryId'])
export class SavedCategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @CreateDateColumn({ name: 'saved_at', type: 'timestamptz' })
  savedAt: Date;

  @Column({ name: 'category_id', type: 'bigint' })
  categoryId: number;

  @ManyToOne(() => CategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: Relation<CategoryEntity>;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;
}

@Entity('content_categorylike')
@Unique(['userId', 'categoryId'])
export class CategoryLikeEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'category_id', type: 'bigint' })
  categoryId: number;

  @ManyToOne(() => CategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: Relation<CategoryEntity>;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;
}

@Entity('gameplay_game')
@Index(['playerId', 'datePlayed'])
export class GameEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'player_id', type: 'integer' })
  playerId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player: Relation<UserEntity>;

  @Column({ type: 'varchar', length: 20 })
  mode: 'offline' | 'solo' | 'online';

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  teams: Array<Record<string, unknown>>;

  @CreateDateColumn({ name: 'date_played', type: 'timestamptz' })
  datePlayed: Date;

  @OneToMany(() => GameCategoryEntity, (link) => link.game)
  categoryLinks?: Relation<GameCategoryEntity[]>;

  @OneToMany(() => PlayedQuestionEntity, (played) => played.game)
  playedQuestions?: Relation<PlayedQuestionEntity[]>;
}

@Entity('gameplay_game_categories')
@Unique(['gameId', 'categoryId'])
export class GameCategoryEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'game_id', type: 'bigint' })
  gameId: number;

  @ManyToOne(() => GameEntity, (game) => game.categoryLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'game_id' })
  game: Relation<GameEntity>;

  @Column({ name: 'category_id', type: 'bigint' })
  categoryId: number;

  @ManyToOne(() => CategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: Relation<CategoryEntity>;
}

@Entity('gameplay_playedquestion')
export class PlayedQuestionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'game_id', type: 'bigint' })
  gameId: number;

  @ManyToOne(() => GameEntity, (game) => game.playedQuestions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'game_id' })
  game: Relation<GameEntity>;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId: number;

  @ManyToOne(() => QuestionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Relation<QuestionEntity>;
}

@Entity('payments_payment')
export class PaymentEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;

  @Column({ name: 'order_id', type: 'varchar', length: 255, unique: true })
  orderId: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 255, default: '' })
  customerId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'variant_id', type: 'varchar', length: 255 })
  variantId: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255, default: '' })
  productName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'webhook_data', type: 'jsonb', nullable: true })
  webhookData: Record<string, unknown> | null;
}

@Entity('payments_subscription')
export class SubscriptionEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'user_id', type: 'integer' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;

  @Column({
    name: 'subscription_id',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  subscriptionId: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 255 })
  customerId: string;

  @Column({ name: 'order_id', type: 'varchar', length: 255, default: '' })
  orderId: string;

  @Column({ name: 'variant_id', type: 'varchar', length: 255 })
  variantId: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255, default: '' })
  productName: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'renews_at', type: 'timestamptz', nullable: true })
  renewsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('payments_webhook_event')
export class PaymentWebhookEventEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  fingerprint: string;

  @Column({ name: 'event_name', type: 'varchar', length: 100 })
  eventName: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 255, default: '' })
  resourceId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}

@Entity('security_auth_rate_limit')
export class AuthRateLimitEntity extends BaseEntity {
  @PrimaryColumn({ name: 'rate_key', type: 'varchar', length: 255 })
  rateKey: string;

  @Column({ name: 'total_hits', type: 'integer' })
  totalHits: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'blocked_until', type: 'timestamptz', nullable: true })
  blockedUntil: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export const ENTITIES = [
  UserEntity,
  UserProfileEntity,
  AuthTokenEntity,
  CollectionEntity,
  CategoryEntity,
  QuestionEntity,
  SavedCategoryEntity,
  CategoryLikeEntity,
  GameEntity,
  GameCategoryEntity,
  PlayedQuestionEntity,
  PaymentEntity,
  SubscriptionEntity,
  PaymentWebhookEventEntity,
  AuthRateLimitEntity,
];
