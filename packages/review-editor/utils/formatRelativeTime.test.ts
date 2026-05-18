import { describe, expect, test } from 'bun:test';
import { formatRelativeTime } from './formatRelativeTime';

describe('formatRelativeTime', () => {
  test('returns "now" for timestamps within 60 seconds', () => {
    const now = Date.now();
    expect(formatRelativeTime(now)).toBe('now');
    expect(formatRelativeTime(now - 30_000)).toBe('now');
    expect(formatRelativeTime(now - 59_000)).toBe('now');
  });

  test('returns minutes for timestamps within 60 minutes', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 60_000)).toBe('1m');
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5m');
    expect(formatRelativeTime(now - 59 * 60_000)).toBe('59m');
  });

  test('returns hours for timestamps within 24 hours', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 60 * 60_000)).toBe('1h');
    expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe('3h');
    expect(formatRelativeTime(now - 23 * 60 * 60_000)).toBe('23h');
  });

  test('returns days for timestamps within 7 days', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 24 * 60 * 60_000)).toBe('1d');
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000)).toBe('3d');
    expect(formatRelativeTime(now - 6 * 24 * 60 * 60_000)).toBe('6d');
  });

  test('returns formatted date for older timestamps (>= 7 days)', () => {
    const now = Date.now();
    const old = now - 7 * 24 * 60 * 60_000;
    const result = formatRelativeTime(old);
    // Should be like "May 11" or similar — contains month abbreviation and day number
    expect(result).not.toBe('now');
    expect(result).not.toMatch(/^\d+[mhd]$/);
    // Should contain a space (month day format)
    expect(result).toContain(' ');
  });

  test('handles exactly 60 seconds boundary (should show 1m)', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 60_000)).toBe('1m');
  });

  test('handles exactly 60 minutes boundary (should show 1h)', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 60 * 60_000)).toBe('1h');
  });

  test('handles exactly 24 hours boundary (should show 1d)', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 24 * 60 * 60_000)).toBe('1d');
  });

  test('handles exactly 7 days boundary (should show date)', () => {
    const now = Date.now();
    const result = formatRelativeTime(now - 7 * 24 * 60 * 60_000);
    expect(result).not.toBe('7d');
    expect(result).toContain(' ');
  });

  test('handles future timestamps (negative diff)', () => {
    const now = Date.now();
    // Future timestamps produce negative seconds, so seconds < 60 → "now"
    expect(formatRelativeTime(now + 30_000)).toBe('now');
  });

  test('handles very old timestamps', () => {
    // Jan 1, 2020
    const result = formatRelativeTime(new Date('2020-01-01').getTime());
    expect(result).toContain(' ');
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/1/);
  });

  test('handles timestamp of 0 (epoch)', () => {
    const result = formatRelativeTime(0);
    expect(result).toContain(' ');
    // Jan 1, 1970
    expect(result).toMatch(/Jan/);
  });
});
