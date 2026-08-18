import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService) {}

  async hash(password: string): Promise<string> {
    const configured = Number(this.config.get('PBKDF2_ITERATIONS', '870000'));
    const iterations =
      Number.isSafeInteger(configured) && configured >= 1_000
        ? configured
        : 870_000;
    const salt = randomBytes(9).toString('base64url');
    const derived = await pbkdf2Async(password, salt, iterations, 32, 'sha256');
    return `pbkdf2_sha256$${iterations}$${salt}$${derived.toString('base64')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    if (!encoded || encoded.startsWith('!')) return false;
    const [algorithm, iterationText, salt, digest] = encoded.split('$');
    if (algorithm !== 'pbkdf2_sha256' || !iterationText || !salt || !digest)
      return false;
    const iterations = Number(iterationText);
    if (!Number.isSafeInteger(iterations) || iterations < 1) return false;
    const derived = await pbkdf2Async(password, salt, iterations, 32, 'sha256');
    const expected = Buffer.from(digest, 'base64');
    return (
      expected.length === derived.length && timingSafeEqual(expected, derived)
    );
  }

  makeResetToken(userId: number, passwordHash: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.signResetToken(userId, passwordHash, timestamp);
    return `${timestamp}-${signature}`;
  }

  verifyResetToken(
    userId: number,
    passwordHash: string,
    token: string,
  ): boolean {
    const separator = token.indexOf('-');
    if (separator < 1) return false;
    const timestamp = Number(token.slice(0, separator));
    const provided = token.slice(separator + 1);
    if (
      !Number.isSafeInteger(timestamp) ||
      Date.now() / 1000 - timestamp > 86_400
    )
      return false;
    const expected = this.signResetToken(userId, passwordHash, timestamp);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private signResetToken(
    userId: number,
    passwordHash: string,
    timestamp: number,
  ): string {
    const secret = this.config.get<string>('APP_SECRET');
    if (!secret) throw new Error('APP_SECRET must be configured');
    return createHmac('sha256', secret)
      .update(`${userId}:${passwordHash}:${timestamp}`)
      .digest('base64url');
  }
}
