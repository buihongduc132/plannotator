import { describe, expect, test } from 'bun:test';
import { detectLanguage } from './detectLanguage';

describe('detectLanguage', () => {
  test('maps common extensions to hljs language names', () => {
    expect(detectLanguage('app.ts')).toBe('typescript');
    expect(detectLanguage('app.tsx')).toBe('typescript');
    expect(detectLanguage('app.js')).toBe('javascript');
    expect(detectLanguage('app.jsx')).toBe('javascript');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('app.rb')).toBe('ruby');
    expect(detectLanguage('app.rs')).toBe('rust');
    expect(detectLanguage('app.go')).toBe('go');
    expect(detectLanguage('App.java')).toBe('java');
    expect(detectLanguage('app.kt')).toBe('kotlin');
    expect(detectLanguage('app.swift')).toBe('swift');
    expect(detectLanguage('app.cs')).toBe('csharp');
    expect(detectLanguage('app.cpp')).toBe('cpp');
    expect(detectLanguage('app.c')).toBe('c');
    expect(detectLanguage('app.h')).toBe('c');
  });

  test('maps web and config languages', () => {
    expect(detectLanguage('style.css')).toBe('css');
    expect(detectLanguage('style.scss')).toBe('scss');
    expect(detectLanguage('style.less')).toBe('less');
    expect(detectLanguage('page.html')).toBe('html');
    expect(detectLanguage('data.xml')).toBe('xml');
    expect(detectLanguage('data.json')).toBe('json');
    expect(detectLanguage('config.yaml')).toBe('yaml');
    expect(detectLanguage('config.yml')).toBe('yaml');
    expect(detectLanguage('README.md')).toBe('markdown');
  });

  test('maps scripting and other languages', () => {
    expect(detectLanguage('query.sql')).toBe('sql');
    expect(detectLanguage('run.sh')).toBe('bash');
    expect(detectLanguage('run.bash')).toBe('bash');
    expect(detectLanguage('run.zsh')).toBe('bash');
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('cargo.toml')).toBe('toml');
    expect(detectLanguage('app.lua')).toBe('lua');
    expect(detectLanguage('app.php')).toBe('php');
  });

  test('returns undefined for unknown extensions', () => {
    expect(detectLanguage('data.xyz')).toBeUndefined();
    expect(detectLanguage('file.bin')).toBeUndefined();
    expect(detectLanguage('image.png')).toBeUndefined();
  });

  test('is case-insensitive for extensions', () => {
    expect(detectLanguage('APP.TS')).toBe('typescript');
    expect(detectLanguage('App.TSX')).toBe('typescript');
    expect(detectLanguage('SCRIPT.PY')).toBe('python');
  });

  test('handles files with multiple dots', () => {
    expect(detectLanguage('src/utils/helper.test.ts')).toBe('typescript');
    expect(detectLanguage('deeply.nested.module.js')).toBe('javascript');
  });

  test('handles files with no extension', () => {
    expect(detectLanguage('Makefile')).toBeUndefined();
    expect(detectLanguage('README')).toBeUndefined();
  });

  test('handles extensionless Dockerfile-like files', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
  });

  test('handles empty string', () => {
    expect(detectLanguage('')).toBeUndefined();
  });

  test('handles dotfiles', () => {
    expect(detectLanguage('.gitignore')).toBeUndefined();
    expect(detectLanguage('.env')).toBeUndefined();
  });

  test('handles path separators', () => {
    expect(detectLanguage('src/components/App.tsx')).toBe('typescript');
    expect(detectLanguage('/absolute/path/to/file.py')).toBe('python');
  });
});
