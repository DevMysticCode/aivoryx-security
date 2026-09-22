import { z } from 'zod';

/**
 * Environment variables are always strings (or undefined). These helpers convert
 * the raw string form into the properly typed value before the rest of the Zod
 * schema validates it, so "false" never survives as a truthy string.
 */

export function booleanFromEnv(defaultValue: boolean): z.ZodType<boolean, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'no'].includes(normalized)) return false;
    }
    // Anything else is passed through unchanged so z.boolean() reports a clear error.
    return value;
  }, z.boolean());
}

export function intFromEnv(
  schema: z.ZodNumber,
  defaultValue?: number,
): z.ZodType<number, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }, schema);
}

export function csvIntListFromEnv(
  defaultValue: number[],
): z.ZodType<number[], z.ZodTypeDef, unknown> {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === '') return defaultValue;
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return value;
      return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => Number(part));
    },
    z.array(z.number().int().min(1).max(65535)).min(1),
  );
}
