import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCategoryDto,
  CreateQuestionDto,
  UpdateCategoryDto,
  UpdateQuestionDto,
} from './content.dto';

describe('Content DTOs', () => {
  it('parses and validates the frontend JSON question format', async () => {
    const dto = plainToInstance(CreateCategoryDto, {
      name: 'Science',
      privacy: 'private',
      questions: JSON.stringify([
        { text: 'Question', answer: 'Answer', points: 400 },
      ]),
    });

    await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    expect(dto.questions).toEqual([
      expect.objectContaining({
        text: 'Question',
        answer: 'Answer',
        points: '400',
      }),
    ]);
  });

  it('coerces multipart numeric aliases without weakening enum validation', async () => {
    const valid = plainToInstance(CreateQuestionDto, {
      category: '12',
      text: 'Question',
      answer: 'Answer',
      points: 200,
    });
    const invalid = plainToInstance(CreateQuestionDto, {
      category: '12',
      text: 'Question',
      answer: 'Answer',
      points: 999,
    });

    await expect(validate(valid, { whitelist: true })).resolves.toHaveLength(0);
    expect(valid.category).toBe(12);
    expect(valid.points).toBe('200');
    expect(await validate(invalid, { whitelist: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'points' })]),
    );
  });

  it('rejects empty and overlong category fields', async () => {
    const empty = plainToInstance(UpdateCategoryDto, { name: '   ' });
    const overlong = plainToInstance(UpdateCategoryDto, {
      name: 'x'.repeat(101),
    });

    await expect(
      validate(empty, { whitelist: true }),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(overlong, { whitelist: true }),
    ).resolves.not.toHaveLength(0);
  });

  it('rejects null for non-nullable update fields but permits clearing choices', async () => {
    const category = plainToInstance(UpdateCategoryDto, { name: null });
    const question = plainToInstance(UpdateQuestionDto, {
      text: null,
      answer: null,
      choice_2: null,
    });

    await expect(
      validate(category, { whitelist: true }),
    ).resolves.not.toHaveLength(0);
    const questionErrors = await validate(question, { whitelist: true });
    expect(questionErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'text' }),
        expect.objectContaining({ property: 'answer' }),
      ]),
    );
    expect(questionErrors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'choice_2' }),
      ]),
    );
  });
});
