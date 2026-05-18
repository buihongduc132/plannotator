import { describe, expect, test } from 'bun:test';
import { extractLinesFromPatch } from './patchParser';

const SAMPLE_PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,4 +10,5 @@ export function main() {',
  '-  const old = "before";',
  '+  const newVar = "after";',
  '+  console.log(newVar);',
  '   return newVar;',
  ' }',
].join('\n');

// Hunk: oldStart=10, newStart=10
// Lines (1-indexed after increment):
//   "-"  → oldLine=10, newLine stays at 9
//   "+"  → oldLine stays at 10, newLine=10
//   "+"  → oldLine stays at 10, newLine=11
//   " "  → oldLine=11, newLine=12
//   " "  → oldLine=12, newLine=13

const MULTI_HUNK_PATCH = [
  'diff --git a/file.ts b/file.ts',
  '--- a/file.ts',
  '+++ b/file.ts',
  '@@ -1,3 +1,3 @@',
  ' line1',
  '-old2',
  '+new2',
  ' line3',
  '@@ -10,3 +10,3 @@',
  ' line10',
  '-old11',
  '+new11',
  ' line12',
].join('\n');

describe('extractLinesFromPatch', () => {
  test('extracts context line from old side (line 11)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 11, 11, 'old');
    expect(result).toBe('  return newVar;');
  });

  test('extracts context line from new side (line 12)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 12, 12, 'new');
    expect(result).toBe('  return newVar;');
  });

  test('extracts deleted line from old side (line 10)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 10, 10, 'old');
    expect(result).toBe('  const old = "before";');
  });

  test('does not include deleted lines on new side', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 10, 10, 'new');
    // Old line 10 was deleted, new side doesn't have a line 10 at this position
    // (newLine is only 9 after header, first "+" increments it to 10)
    // Actually new line 10 = "+const newVar", not deleted. But we're asking for the
    // deletion line position. Let's check: oldLine=10 is deletion, new line 10 = addition
    // Since old line 10 doesn't exist on new side, we should get empty
    // But newLine also reaches 10 for the addition line, so new line 10 = "const newVar"
    expect(result).toBe('  const newVar = "after";');
  });

  test('extracts added lines from new side (line 10)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 10, 10, 'new');
    expect(result).toBe('  const newVar = "after";');
  });

  test('extracts added lines from new side (line 11)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 11, 11, 'new');
    expect(result).toBe('  console.log(newVar);');
  });

  test('does not include added lines on old side — added lines skip old counter', () => {
    // New line 11 was an addition (console.log). Old side doesn't have a line 10
    // that matches the addition. But old line 11 = context "return newVar".
    // To truly test that additions don't appear on old side, we check a line
    // that only exists on the new side. The additions are at new 10 and new 11.
    // On old side, line 10 = deletion, line 11 = context. So old 10 contains
    // the deletion text, not the addition text.
    const result = extractLinesFromPatch(SAMPLE_PATCH, 10, 10, 'old');
    expect(result).toBe('  const old = "before";');  // deletion, not addition
    expect(result).not.toContain('newVar = "after"');
    expect(result).not.toContain('console.log');
  });

  test('extracts multi-line range from new side (11-12)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 11, 12, 'new');
    expect(result).toBe('  console.log(newVar);\n  return newVar;');
  });

  test('extracts multi-line range from new side (10-12)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 10, 12, 'new');
    expect(result).toBe('  const newVar = "after";\n  console.log(newVar);\n  return newVar;');
  });

  test('handles empty patch', () => {
    const result = extractLinesFromPatch('', 1, 1, 'old');
    expect(result).toBe('');
  });

  test('handles patch with no matching line range', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 999, 999, 'old');
    expect(result).toBe('');
  });

  test('handles multiple hunks — first hunk old line 2', () => {
    // First hunk: oldStart=1, newStart=1
    // " line1" → oldLine=1, newLine=1
    // "-old2"  → oldLine=2
    const result = extractLinesFromPatch(MULTI_HUNK_PATCH, 2, 2, 'old');
    expect(result).toBe('old2');
  });

  test('handles multiple hunks — first hunk new line 2', () => {
    // "+new2" → newLine=2
    const result = extractLinesFromPatch(MULTI_HUNK_PATCH, 2, 2, 'new');
    expect(result).toBe('new2');
  });

  test('handles multiple hunks — second hunk old line 11', () => {
    const result = extractLinesFromPatch(MULTI_HUNK_PATCH, 11, 11, 'old');
    expect(result).toBe('old11');
  });

  test('handles multiple hunks — second hunk new line 11', () => {
    const result = extractLinesFromPatch(MULTI_HUNK_PATCH, 11, 11, 'new');
    expect(result).toBe('new11');
  });

  test('extracts context lines from multiple hunks', () => {
    const result = extractLinesFromPatch(MULTI_HUNK_PATCH, 1, 1, 'old');
    expect(result).toBe('line1');

    const result2 = extractLinesFromPatch(MULTI_HUNK_PATCH, 10, 10, 'new');
    expect(result2).toBe('line10');
  });

  test('skips diff headers', () => {
    const headerPatch = [
      'diff --git a/f.ts b/f.ts',
      'index abc..def 100644',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');

    const oldResult = extractLinesFromPatch(headerPatch, 1, 1, 'old');
    expect(oldResult).toBe('old');

    const newResult = extractLinesFromPatch(headerPatch, 1, 1, 'new');
    expect(newResult).toBe('new');
  });

  test('handles hunk header without count', () => {
    const patch = [
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    const oldResult = extractLinesFromPatch(patch, 1, 1, 'old');
    expect(oldResult).toBe('old');
  });

  test('returns empty for out-of-order range (start > end)', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 5, 3, 'old');
    expect(result).toBe('');
  });

  test('handles line range spanning additions and context on new side', () => {
    const result = extractLinesFromPatch(SAMPLE_PATCH, 11, 13, 'new');
    // new 11: +  console.log(newVar);
    // new 12: (context) return newVar;
    // new 13: (context) }
    expect(result).toContain('console.log(newVar)');
    expect(result).toContain('return newVar');
    expect(result).toContain('}');
  });
});
