import * as session from 'express-session';
import type { SessionData } from 'express-session';
import { DataSource } from 'typeorm';
import { AdminSessionEntity } from '../database/entities';

const DEFAULT_MAX_AGE = 8 * 60 * 60 * 1000;

export class PostgresSessionStore extends session.Store {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  get(
    sessionId: string,
    callback: (error: Error | null, session?: SessionData | null) => void,
  ): void {
    void this.dataSource
      .getRepository(AdminSessionEntity)
      .findOneBy({ sessionId })
      .then((record) => {
        if (!record || record.expiresAt <= new Date()) {
          if (record) this.destroy(sessionId, () => undefined);
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(record.data) as SessionData);
      })
      .catch((error: unknown) => callback(toError(error)));
  }

  set(
    sessionId: string,
    value: SessionData,
    callback: (error?: Error | null) => void,
  ): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + (value.cookie.maxAge ?? DEFAULT_MAX_AGE));
    void this.dataSource
      .getRepository(AdminSessionEntity)
      .upsert({ sessionId, data: JSON.stringify(value), expiresAt }, [
        'sessionId',
      ])
      .then(() => callback(null))
      .catch((error: unknown) => callback(toError(error)));
  }

  destroy(sessionId: string, callback: (error?: Error | null) => void): void {
    void this.dataSource
      .getRepository(AdminSessionEntity)
      .delete({ sessionId })
      .then(() => callback(null))
      .catch((error: unknown) => callback(toError(error)));
  }

  touch(
    sessionId: string,
    value: SessionData,
    callback: (error?: Error | null) => void,
  ): void {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + (value.cookie.maxAge ?? DEFAULT_MAX_AGE));
    void this.dataSource
      .getRepository(AdminSessionEntity)
      .update({ sessionId }, { expiresAt })
      .then(() => callback(null))
      .catch((error: unknown) => callback(toError(error)));
  }

  clear(callback: (error?: Error | null) => void): void {
    void this.dataSource
      .getRepository(AdminSessionEntity)
      .clear()
      .then(() => callback(null))
      .catch((error: unknown) => callback(toError(error)));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
