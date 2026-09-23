import { BadRequestException } from '@nestjs/common';

export function integerId(value: string | number, field = 'id'): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException({
      [field]: `${field} must be a positive integer`,
    });
  }
  return parsed;
}

export function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return fallback;
}

export function parsePagination(
  query: Record<string, string | string[] | undefined>,
  defaultLimit = 50,
  maxLimit = 100,
) {
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const rawOffset = Array.isArray(query.offset)
    ? query.offset[0]
    : query.offset;
  const limit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new BadRequestException({
      limit: `limit must be between 1 and ${maxLimit}`,
    });
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BadRequestException({ offset: 'offset must be >= 0' });
  }
  return { limit, offset };
}

export function paginated<T>(
  results: T[],
  total = results.length,
  offset = 0,
  limit = results.length,
) {
  const paginatedResponse = offset > 0 || results.length < total;
  return {
    count: total,
    next:
      paginatedResponse && offset + results.length < total
        ? offset + results.length
        : null,
    previous:
      paginatedResponse && offset > 0 ? Math.max(0, offset - limit) : null,
    results,
  };
}
