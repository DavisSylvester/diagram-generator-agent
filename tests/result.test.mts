import { describe, expect, it } from 'bun:test';
import { ok, err } from '../src/types/index.mts';
import type { Result } from '../src/types/index.mts';

describe(`Result type`, () => {
  it(`should create Ok result`, () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  it(`should create Err result`, () => {
    const result = err(new Error(`test error`));
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe(`test error`);
  });

  it(`should narrow types correctly`, () => {
    const result: Result<number, Error> = ok(42);

    if (result.ok) {
      expect(result.value).toBe(42);
    } else {
      throw new Error(`Should not reach here`);
    }
  });

  it(`should handle generic error types`, () => {
    const result: Result<string, string> = err(`custom error`);

    if (!result.ok) {
      expect(result.error).toBe(`custom error`);
    }
  });
});
