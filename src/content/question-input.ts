import { BadRequestException } from '@nestjs/common';

const indexedQuestionPattern = /^questions\[(\d+)]\[(\w+)]$/;

export function parseQuestionJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException({ error: 'Invalid questions format' });
  }
}

export function isIndexedQuestionField(key: string): boolean {
  return indexedQuestionPattern.test(key);
}

export function collectIndexedQuestionFields(
  entries: Iterable<[string, unknown]>,
): Map<number, Record<string, unknown>> {
  const indexed = new Map<number, Record<string, unknown>>();
  for (const [key, value] of entries) {
    const match = indexedQuestionPattern.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    indexed.set(index, {
      ...(indexed.get(index) || {}),
      [match[2]]: value,
    });
  }
  return indexed;
}
