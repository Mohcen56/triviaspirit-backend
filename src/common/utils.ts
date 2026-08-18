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

export function booleanValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(stringValue(value).toLowerCase());
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

export function paginated<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}
