import { describe, expect, test } from 'bun:test';
import { formatLineRange, formatTokenContext } from './formatLineRange';

describe('formatLineRange', () => {
  test('formats single line when start equals end', () => {
    expect(formatLineRange(5, 5)).toBe('Line 5');
    expect(formatLineRange(1, 1)).toBe('Line 1');
    expect(formatLineRange(100, 100)).toBe('Line 100');
  });

  test('formats multi-line range', () => {
    expect(formatLineRange(5, 12)).toBe('Lines 5-12');
    expect(formatLineRange(1, 3)).toBe('Lines 1-3');
  });

  test('normalizes swapped start/end (uses Math.min/max)', () => {
    expect(formatLineRange(12, 5)).toBe('Lines 5-12');
    expect(formatLineRange(10, 1)).toBe('Lines 1-10');
  });

  test('handles zero-based lines', () => {
    expect(formatLineRange(0, 0)).toBe('Line 0');
    expect(formatLineRange(0, 5)).toBe('Lines 0-5');
  });
});

describe('formatTokenContext', () => {
  test('formats short token', () => {
    const result = formatTokenContext({
      anchor: { lineNumber: 5 },
      fullText: 'const x = 1;',
    });
    expect(result).toBe('Line 5: `const x = 1;`');
  });

  test('truncates long tokens with ellipsis at 27 chars + ...', () => {
    const longText = 'a'.repeat(40);
    const result = formatTokenContext({
      anchor: { lineNumber: 10 },
      fullText: longText,
    });
    expect(result).toBe(`Line 10: \`${'a'.repeat(27)}...\``);
    expect(result.length).toBeLessThan(longText.length + 20);
  });

  test('does NOT truncate tokens at exactly 30 chars', () => {
    const text30 = 'a'.repeat(30);
    const result = formatTokenContext({
      anchor: { lineNumber: 1 },
      fullText: text30,
    });
    expect(result).toBe(`Line 1: \`${text30}\``);
  });

  test('truncates tokens at 31 chars', () => {
    const text31 = 'a'.repeat(31);
    const result = formatTokenContext({
      anchor: { lineNumber: 1 },
      fullText: text31,
    });
    expect(result).toContain('...');
    expect(result).toBe(`Line 1: \`${'a'.repeat(27)}...\``);
  });

  test('handles empty token text', () => {
    const result = formatTokenContext({
      anchor: { lineNumber: 3 },
      fullText: '',
    });
    expect(result).toBe('Line 3: ``');
  });

  test('handles line number 0', () => {
    const result = formatTokenContext({
      anchor: { lineNumber: 0 },
      fullText: 'token',
    });
    expect(result).toBe('Line 0: `token`');
  });
});
