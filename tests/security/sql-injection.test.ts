import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const API_SRC = join(__dirname, '../../packages/api/src');

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getAllTsFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('SQL Injection Prevention', () => {
  const apiFiles = getAllTsFiles(API_SRC);

  it('should NOT use $executeRawUnsafe anywhere', () => {
    const violations: string[] = [];
    for (const file of apiFiles) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('$executeRawUnsafe')) {
        violations.push(file.replace(API_SRC, ''));
      }
    }
    expect(violations).toEqual([]);
  });

  it('should NOT use $queryRawUnsafe anywhere', () => {
    const violations: string[] = [];
    for (const file of apiFiles) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('$queryRawUnsafe')) {
        violations.push(file.replace(API_SRC, ''));
      }
    }
    expect(violations).toEqual([]);
  });

  it('should NOT use string interpolation in raw SQL', () => {
    const violations: string[] = [];
    const pattern = /\$queryRaw\(`[^`]*\$\{/;
    for (const file of apiFiles) {
      const content = readFileSync(file, 'utf8');
      if (pattern.test(content)) {
        violations.push(file.replace(API_SRC, ''));
      }
    }
    expect(violations).toEqual([]);
  });
});
