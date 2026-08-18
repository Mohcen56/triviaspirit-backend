import { BadRequestException } from '@nestjs/common';
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
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? plainToInstance(CreateQuestionInputDto, parsed)
      : parsed;
  } catch {
    throw new BadRequestException({ error: 'Invalid questions format' });
  }
}

const stringValue = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

export class CreateQuestionInputDto {
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  text: string;

  @IsOptional()
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  answer_ar?: string;

  @IsOptional()
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @IsOptional()
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  points?: QuestionDifficulty;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text_ar?: string;

  @IsOptional()
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  answer_ar?: string;

  @IsOptional()
  @Transform(stringValue)
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @IsOptional()
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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(CategoryPrivacy)
  privacy?: CategoryPrivacy;

  @IsOptional()
  @Transform(parseQuestions)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionInputDto)
  questions?: CreateQuestionInputDto[];
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(CategoryPrivacy)
  privacy?: CategoryPrivacy;

  @IsOptional()
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
