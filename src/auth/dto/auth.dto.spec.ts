import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto, UpdateProfileDto } from './auth.dto';

describe('Auth DTO null semantics', () => {
  it('rejects null for optional-but-non-nullable profile fields', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      username: null,
      email: null,
      first_name: null,
      last_name: null,
    });

    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['username', 'email', 'first_name', 'last_name']),
    );
  });

  it('still accepts omitted optional registration fields', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'person@example.com',
      password: 'InitialPass123',
    });

    await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
  });
});
