import { describe, expect, test } from 'bun:test';
import { buildFileTree, getAncestorPaths, getAllFolderPaths, type FileTreeNode } from './buildFileTree';
import type { DiffFile } from '../types';

function makeFile(path: string, additions = 1, deletions = 0, patch = ''): DiffFile {
  return { path, additions, deletions, patch };
}

describe('buildFileTree', () => {
  test('returns empty array for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  test('creates a flat list of file nodes for shallow paths', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe('file');
    expect(tree[0].name).toBe('a.ts');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].fileIndex).toBe(0);
    expect(tree[0].additions).toBe(1);
    expect(tree[1].name).toBe('b.ts');
    expect(tree[1].fileIndex).toBe(1);
  });

  test('unwraps single root folder when all children are files (flat fallback)', () => {
    // src/a.ts + src/b.ts → single folder "src" with only file children → unwrapped to flat files
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe('file');
    expect(tree[0].name).toBe('a.ts');
    expect(tree[0].depth).toBe(0);
    expect(tree[1].name).toBe('b.ts');
    expect(tree[1].depth).toBe(0);
  });

  test('unwraps deeply nested single-chain to just the file', () => {
    // a/b/c/file.ts → all single-child folders collapse, then single root folder unwraps
    const files = [makeFile('a/b/c/file.ts')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('file');
    expect(tree[0].name).toBe('file.ts');
    expect(tree[0].depth).toBe(0);
  });

  test('does not unwrap single root folder when it has subfolders', () => {
    // src/components/A.tsx + src/utils/b.ts → "src" has folder children → preserved
    const files = [makeFile('src/components/A.tsx'), makeFile('src/utils/b.ts')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('src');
    expect(tree[0].children).toHaveLength(2);
    // Folders sorted alphabetically
    expect(tree[0].children![0].name).toBe('components');
    expect(tree[0].children![0].type).toBe('folder');
    expect(tree[0].children![1].name).toBe('utils');
    expect(tree[0].children![1].type).toBe('folder');
  });

  test('aggregates additions and deletions up the tree', () => {
    const files = [makeFile('src/components/A.tsx', 5, 2), makeFile('src/utils/b.ts', 3, 1)];
    const tree = buildFileTree(files);

    // "src" folder aggregates from all descendants
    expect(tree[0].additions).toBe(8);
    expect(tree[0].deletions).toBe(3);
  });

  test('sorts folders before files, alphabetically within each group', () => {
    const files = [
      makeFile('z-file.ts'),
      makeFile('a-folder/file.ts'),
      makeFile('a-file.ts'),
      makeFile('b-folder/file.ts'),
    ];
    const tree = buildFileTree(files);

    const names = tree.map(n => n.name);
    expect(names).toEqual(['a-folder', 'b-folder', 'a-file.ts', 'z-file.ts']);
  });

  test('handles mixed shallow and nested files', () => {
    const files = [makeFile('root.ts'), makeFile('src/components/nested.ts')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    // Folder first: src → components is a single-child chain, collapses to "src/components"
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('src/components');
    // Then file
    expect(tree[1].type).toBe('file');
    expect(tree[1].name).toBe('root.ts');
  });

  test('handles root-level files with same name in different dirs', () => {
    const files = [makeFile('a/index.ts'), makeFile('b/index.ts')];
    const tree = buildFileTree(files);

    // Two separate folders at top level — not a single root, so they stay as folders
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('a');
    expect(tree[0].children![0].name).toBe('index.ts');
    expect(tree[1].type).toBe('folder');
    expect(tree[1].name).toBe('b');
    expect(tree[1].children![0].name).toBe('index.ts');
  });

  test('preserves file data reference', () => {
    const file = makeFile('test.ts', 10, 5, 'patch-content');
    const tree = buildFileTree([file]);

    expect(tree[0].file).toBe(file);
    expect(tree[0].file?.patch).toBe('patch-content');
  });

  test('handles file with empty segments in path', () => {
    const files = [makeFile('src//file.ts')];
    const tree = buildFileTree(files);

    // Double slash creates empty segment filtered by .filter(Boolean)
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('file');
  });

  test('collapse merges single-child folder chains', () => {
    // Multiple files in a deep nested structure where some intermediate folders are single-child
    const files = [
      makeFile('src/a.ts'),
      makeFile('src/deep/nested/b.ts'),
    ];
    const tree = buildFileTree(files);

    // "src" has multiple children (file a.ts + folder deep), so it stays
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('src');
    // "deep" folder has single child "nested" → collapses to "deep/nested"
    const deepFolder = tree[0].children!.find(c => c.type === 'folder');
    expect(deepFolder?.name).toBe('deep/nested');
  });

  test('maintains correct depths after collapse', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/deep/nested/b.ts')];
    const tree = buildFileTree(files);

    expect(tree[0].depth).toBe(0);
    const fileA = tree[0].children!.find(c => c.name === 'a.ts');
    expect(fileA?.depth).toBe(1);
    const collapsedFolder = tree[0].children!.find(c => c.name === 'deep/nested');
    expect(collapsedFolder?.depth).toBe(1);
    expect(collapsedFolder?.children![0].depth).toBe(2);
  });
});

describe('getAncestorPaths', () => {
  test('returns empty for single-segment path', () => {
    expect(getAncestorPaths('file.ts')).toEqual([]);
  });

  test('returns parent for two-segment path', () => {
    expect(getAncestorPaths('src/file.ts')).toEqual(['src']);
  });

  test('returns all ancestors for deep path', () => {
    expect(getAncestorPaths('a/b/c/file.ts')).toEqual([
      'a',
      'a/b',
      'a/b/c',
    ]);
  });

  test('handles trailing slash', () => {
    // "a/b/" → split gives ["a", "b", ""], filter(Boolean) → ["a", "b"]
    expect(getAncestorPaths('a/b/')).toEqual(['a']);
  });

  test('handles empty string', () => {
    expect(getAncestorPaths('')).toEqual([]);
  });
});

describe('getAllFolderPaths', () => {
  test('returns empty for file-only tree', () => {
    const nodes: FileTreeNode[] = [
      { type: 'file', name: 'a.ts', path: 'a.ts', depth: 0, additions: 1, deletions: 0 },
    ];
    expect(getAllFolderPaths(nodes)).toEqual([]);
  });

  test('returns folder paths at single level', () => {
    const nodes: FileTreeNode[] = [
      {
        type: 'folder', name: 'src', path: 'src', depth: 0,
        children: [], additions: 0, deletions: 0,
      },
    ];
    expect(getAllFolderPaths(nodes)).toEqual(['src']);
  });

  test('returns nested folder paths recursively', () => {
    const nodes: FileTreeNode[] = [
      {
        type: 'folder', name: 'src', path: 'src', depth: 0,
        additions: 0, deletions: 0,
        children: [
          {
            type: 'folder', name: 'components', path: 'src/components', depth: 1,
            additions: 0, deletions: 0, children: [],
          },
        ],
      },
    ];
    expect(getAllFolderPaths(nodes)).toEqual(['src', 'src/components']);
  });

  test('skips file nodes in mixed tree', () => {
    const nodes: FileTreeNode[] = [
      {
        type: 'folder', name: 'src', path: 'src', depth: 0,
        additions: 1, deletions: 0,
        children: [
          { type: 'file', name: 'a.ts', path: 'src/a.ts', depth: 1, additions: 1, deletions: 0 },
        ],
      },
    ];
    expect(getAllFolderPaths(nodes)).toEqual(['src']);
  });
});
