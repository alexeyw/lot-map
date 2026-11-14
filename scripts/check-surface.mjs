// Holds two of PRINCIPLES.md's promises that a test cannot see from inside the engine:
//   1. the mod hooks and calls exactly what `surface.txt` lists (so a new engine call, an environment read or a new
//      hook shows in a pull request as a change to that file), and none of the calls that reach outside the session;
//   2. the defaults the tests hold are the defaults `.claude-plugin/plugin.json` documents.
// Run from the repository's root: `node scripts/check-surface.mjs` (add `--write` to rewrite surface.txt).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const fail = message => {
  console.error(`check-surface: ${message}`)
  process.exitCode = 1
}

// ---- 1. what the mod hooks and calls -----------------------------------------------------------------

const report = execFileSync(process.env.CLAUDE ?? 'claude', ['plugin', 'validate', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const KINDS = ['hooks', 'calls', 'env writes', 'env reads', 'state writes', 'state reads']
const surface = report
  .split('\n')
  .map(line => /❯ (\S+) (hooks|calls|env writes|env reads|state writes|state reads): (.*)$/.exec(line))
  .filter(Boolean)
  // One name per line, without the notes in brackets that differ between versions of Claude Code.
  .flatMap(([, file, kind, names]) => names.replace(/ \((?:via|default)[^)]*\)/g, '').split(/, (?![^{]*\})/).map(name => `${file} ${kind}: ${name}`))
  .sort((a, b) => KINDS.indexOf(a.split(' ').slice(1).join(' ').split(':')[0]) - KINDS.indexOf(b.split(' ').slice(1).join(' ').split(':')[0]) || a.localeCompare(b))
  .join('\n') + '\n'

if (!surface.includes(' calls: ')) fail('could not read what the mod calls from `claude plugin validate .`')

const listed = new URL('surface.txt', here)
if (process.argv.includes('--write')) {
  writeFileSync(listed, surface)
  console.log('check-surface: scripts/surface.txt rewritten')
} else {
  const expected = readFileSync(listed, 'utf8')
  if (surface !== expected) {
    const now = new Set(surface.split('\n'))
    const before = new Set(expected.split('\n'))
    for (const line of now) if (!before.has(line)) console.error(`  + ${line}`)
    for (const line of before) if (!now.has(line)) console.error(`  - ${line}`)
    fail('the mod hooks or calls something scripts/surface.txt does not list. If that is meant, run `node scripts/check-surface.mjs --write`, and say in PRIVACY.md and PRINCIPLES.md what changed.')
  }
}

// Whatever surface.txt says, these never: the calls that read files, run processes, ask a model, add to the
// conversation or change what the model is sent.
const OUTSIDE = /\$\.(fs|process|model|net|http|agent|tool|audio|session\.append|prompt)\b/
for (const line of surface.split('\n')) if (line.includes(' calls: ') && OUTSIDE.test(line)) fail(`a call that reaches outside the session: ${line}`)
for (const line of surface.split('\n')) if (/ hooks: (prompt\.compose|session\.append|tool\.describe|tool\.check)/.test(line)) fail(`a hook that can change what the model is sent or what is allowed: ${line}`)
if (/\b(fetch|XMLHttpRequest|WebSocket|require)\s*\(|\bimport\s*\(/.test(['register.tsx', 'terminal.tsx', 'braille.ts', 'classify.ts', 'draw.ts', 'feed.ts', 'setup.ts', 'palette.ts', 'raster.ts'].map(f => readFileSync(new URL(`../hooks/${f}`, here), 'utf8')).join('\n')))
  fail('the hooks module names fetch, a socket or a dynamic import')

// ---- 2. the defaults ---------------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', here), 'utf8'))
const documented = JSON.stringify(Object.fromEntries(Object.entries(manifest.userConfig).map(([name, field]) => [name, field.default])))
const held = /^const DEFAULTS = (\{.*\})$/m.exec(readFileSync(new URL('../hooks/principles.test.tsx', here), 'utf8'))?.[1]
if (held === undefined) fail('hooks/principles.test.tsx has no `const DEFAULTS = {…}` line')
else if (JSON.stringify(JSON.parse(held)) !== documented) fail(`the defaults in hooks/principles.test.tsx are not the manifest's. Set the line to:\nconst DEFAULTS = ${documented}`)

if (process.exitCode === undefined) console.log(`check-surface: ${surface.trim().split('\n').length} hooks and calls as listed, none reaching outside; ${Object.keys(manifest.userConfig).length} defaults as documented`)
