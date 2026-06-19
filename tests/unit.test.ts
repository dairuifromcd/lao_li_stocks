import { describe, expect, it } from 'vitest';
import { roundToInt } from '../src/utils';

describe('roundToInt', () => {
  it('rounds to nearest integer', () => {
    expect(roundToInt(1.2)).toBe(1);
    expect(roundToInt(1.5)).toBe(2);
  });
});
