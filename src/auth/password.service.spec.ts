import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService(
    new ConfigService({ APP_SECRET: 'test-secret', PBKDF2_ITERATIONS: '1000' }),
  );

  it('creates Django-compatible PBKDF2 hashes', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^pbkdf2_sha256\$1000\$/);
    await expect(
      service.verify('correct horse battery staple', hash),
    ).resolves.toBe(true);
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });

  it('invalidates reset tokens after a password change', () => {
    const token = service.makeResetToken(7, 'old-hash');
    expect(service.verifyResetToken(7, 'old-hash', token)).toBe(true);
    expect(service.verifyResetToken(7, 'new-hash', token)).toBe(false);
  });
});
