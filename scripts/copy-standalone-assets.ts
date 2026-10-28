// AMBER — Standalone Asset Copier (Cross-Platform)
// Copies .next/static, public, and db assets into .next/standalone and dereferences any symlinks.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  rmSync,
} from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'

const root = process.cwd()
const standaloneDir = join(root, '.next', 'standalone')
const staticSrc = join(root, '.next', 'static')
const staticDest = join(standaloneDir, '.next', 'static')
const publicSrc = join(root, 'public')
const publicDest = join(standaloneDir, 'public')
const dbSrc = join(root, 'db')
const dbDest = join(standaloneDir, 'db')
const buildSrc = join(root, 'build')
const buildDest = join(standaloneDir, 'build')
const configSrc = join(root, 'config')
const configDest = join(standaloneDir, 'config')

if (existsSync(staticSrc)) {
  mkdirSync(join(standaloneDir, '.next'), { recursive: true })
  cpSync(staticSrc, staticDest, { recursive: true, force: true })
}

if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true, force: true })
}

if (existsSync(dbSrc)) {
  mkdirSync(dbDest, { recursive: true })
  cpSync(dbSrc, dbDest, { recursive: true, force: true })
}

if (existsSync(buildSrc)) {
  mkdirSync(buildDest, { recursive: true })
  cpSync(buildSrc, buildDest, { recursive: true, force: true })
}

if (existsSync(configSrc)) {
  mkdirSync(configDest, { recursive: true })
  cpSync(configSrc, configDest, { recursive: true, force: true })
}

// Prune any non-production or build artifact folders copied by Next.js standalone tracing
const pruneDirs = ['dist-desktop', 'download', 'examples', 'mini-services', 'tests']
for (const p of pruneDirs) {
  const target = join(standaloneDir, p)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
}

// Dereference any symbolic links created by Next.js / Turbopack to prevent EPERM errors in Windows packagers
function dereferenceSymlinks(dir: string) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    try {
      const stat = lstatSync(fullPath)
      if (stat.isSymbolicLink()) {
        const rawTarget = readlinkSync(fullPath)
        const target = isAbsolute(rawTarget) ? rawTarget : resolve(dir, rawTarget)
        unlinkSync(fullPath)
        if (existsSync(target)) {
          cpSync(target, fullPath, { recursive: true, dereference: true, force: true })
          console.log(`Dereferenced symlink: ${entry} -> real directory`)
        }
      } else if (stat.isDirectory()) {
        dereferenceSymlinks(fullPath)
      }
    } catch (err) {
      // skip unreadable nodes
    }
  }
}

dereferenceSymlinks(join(standaloneDir, '.next', 'node_modules'))

console.log('Standalone assets copied and dereferenced successfully.')
