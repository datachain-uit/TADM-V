import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');

const EXEMPT = ['models/', 'scripts/', 'tests/'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function importPaths(filePath: string): string[] {
  const source = stripComments(fs.readFileSync(filePath, 'utf8'));
  const found: string[] = [];
  const pattern = /(?:require\(\s*|\bfrom\s*|\bimport\s+)["']([^"']+)["']/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    found.push(match[1] as string);
  }

  return found;
}

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }

  return files;
}

function relativeOf(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

function importsModel(importPath: string): boolean {
  return /(^|\/)models\//.test(importPath);
}

const allFiles = listSourceFiles(SRC);

test('10.4.4: the check reads real source — repositories import models, and app files exist', () => {
  const repositories = allFiles.filter((file) => relativeOf(file).startsWith('repositories/'));
  const repositoriesWithModel = repositories.filter((file) => importPaths(file).some(importsModel));
  const services = allFiles.filter((file) => relativeOf(file).startsWith('services/'));

  assert.ok(repositoriesWithModel.length >= 7, `only ${repositoriesWithModel.length} repositories import a model`);
  assert.ok(services.length >= 10, `only ${services.length} service files found`);
});

test('10.4.4: only repositories/ import models/ (models, scripts, tests exempt)', () => {
  const offenders: string[] = [];

  for (const file of allFiles) {
    const relative = relativeOf(file);

    if (relative.startsWith('repositories/') || EXEMPT.some((prefix) => relative.startsWith(prefix))) {
      continue;
    }

    for (const importPath of importPaths(file)) {
      if (importsModel(importPath)) {
        offenders.push(`${relative} -> ${importPath}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('10.4.4: services/ never import express', () => {
  const offenders = allFiles
    .filter((file) => /^services\//.test(relativeOf(file)))
    .filter((file) => importPaths(file).includes('express'))
    .map(relativeOf);

  assert.deepEqual(offenders, []);
});

test('R3.6: the web layer (routes, controllers, middlewares) never imports repositories/ or models/', () => {
  const offenders: string[] = [];

  for (const file of allFiles) {
    const relative = relativeOf(file);

    if (!/^(routes|controllers|middlewares)\//.test(relative)) {
      continue;
    }

    for (const importPath of importPaths(file)) {
      if (/(^|\/)(repositories|models)\//.test(importPath)) {
        offenders.push(`${relative} -> ${importPath}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
