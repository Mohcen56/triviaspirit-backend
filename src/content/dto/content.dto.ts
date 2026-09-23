import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { parseQuestionJson } from '../question-input';

export enum CategoryPrivacy {
  Public = 'public',
  Private = 'private',
}

export enum QuestionDifficulty {
  Easy = '200',
  Medium = '400',
  Hard = '600',
}

function parseQuestions({ value }: { value: unknown }): unknown {
  const parsed = parseQuestionJson(value);
  return Array.isArray(parsed)
    ? plainToInstance(CreateQuestionInputDto, parsed)
    : parsed;
}

const stringValue = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

const isProvided = (_object: unknown, value: unknown) => value !== undefined;

export class CreateQuestionInputDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  text: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(5000)
  text_ar?: string;

  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(200)
  answer: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_3?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_4?: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(200)
  answer_ar?: string;

  @ValidateIf(isProvided)
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ValidateIf(isProvided)
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  points?: QuestionDifficulty;
}

export class UpdateQuestionDto {
  @ValidateIf(isProvided)
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  text?: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(5000)
  text_ar?: string;

  @ValidateIf(isProvided)
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(200)
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_3?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  choice_4?: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(200)
  answer_ar?: string;

  @ValidateIf(isProvided)
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ValidateIf(isProvided)
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  points?: QuestionDifficulty;
}

export class CreateQuestionDto extends CreateQuestionInputDto {
  @ValidateIf((dto: CreateQuestionDto) => dto.category_id === undefined)
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category?: number;

  @ValidateIf((dto: CreateQuestionDto) => dto.category === undefined)
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(100)
  name: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ValidateIf(isProvided)
  @IsEnum(CategoryPrivacy)
  privacy?: CategoryPrivacy;

  @ValidateIf(isProvided)
  @Transform(parseQuestions)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionInputDto)
  questions?: CreateQuestionInputDto[];
}

export class UpdateCategoryDto {
  @ValidateIf(isProvided)
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(100)
  name?: string;

  @ValidateIf(isProvided)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ValidateIf(isProvided)
  @IsEnum(CategoryPrivacy)
  privacy?: CategoryPrivacy;

  @ValidateIf(isProvided)
  @Transform(parseQuestions)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionInputDto)
  questions?: CreateQuestionInputDto[];
}

export class AddQuestionsDto {
  @Transform(parseQuestions)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionInputDto)
  questions: CreateQuestionInputDto[];
}
