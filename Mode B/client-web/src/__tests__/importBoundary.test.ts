import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))


const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const DECLARED_PACKAGES = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
])

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew URL\(\s*)['"]([^'"]+)['"]/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

interface ImportUse {
  file: string
  specifier: string
}

const FILES = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'scripts'))]

const IMPORTS: ImportUse[] = FILES.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(SPECIFIER)]
    .map((match) => ({ file, specifier: match[1] ?? '' }))
    .filter((use) => !use.specifier.startsWith('data:')),
)

function isPath(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('@/')
}

function resolveSpecifier(use: ImportUse): string {
  const bare = use.specifier.split('?')[0] ?? ''
  return bare.startsWith('@/') ? resolve(ROOT, 'src', bare.slice(2)) : resolve(dirname(use.file), bare)
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
}

function isNodeOnlyFile(file: string): boolean {
  return file.endsWith('.test.ts') || file.startsWith(join(ROOT, 'scripts') + sep)
}

const show = (use: ImportUse) => `${relative(ROOT, use.file)} → ${use.specifier}`

describe('the student page imports only its own code', () => {
  it('reads the real source code (the check is not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(50)
    expect(IMPORTS.length).toBeGreaterThan(150)
  })

  it('every import path stays inside client-web', () => {
    const outside = IMPORTS.filter((use) => isPath(use.specifier))
      .filter((use) => {
        const target = resolveSpecifier(use)
        return !(target === ROOT || target.startsWith(ROOT + sep))
      })
      .map(show)
    expect(outside).toEqual([])
  })

  it('does not import university-side code (admin-web, backend)', () => {
    const schoolSide = IMPORTS.filter((use) => /(^|[/\\])(admin-web|backend)([/\\]|$)/.test(use.specifier)).map(show)
    expect(schoolSide).toEqual([])
  })

  it('npm packages are all declared in package.json; Node built-in modules are used only in tests and scripts', () => {
    const problems = IMPORTS.filter((use) => !isPath(use.specifier))
      .filter((use) => {
        const name = packageName(use.specifier)
        const isNodeModule = name.startsWith('node:') || builtinModules.includes(name)
        if (isNodeModule) return !isNodeOnlyFile(use.file)
        return !DECLARED_PACKAGES.has(name)
      })
      .map(show)
    expect(problems).toEqual([])
  })
})
