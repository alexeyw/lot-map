// Holds two of PRINCIPLES.md's promises that a test cannot see from inside the engine:
//   1. the mod hooks and calls exactly what `surface.txt` lists (so a new engine call, an environment read or a new
//      hook shows in a pull request as a change to that file), and none of the calls that reach outside the session;
//      with each call, what it is given as its first argument, since one call can answer more for one argument than
//      for another: `$.session.usage({ breakdown })` answers with what the context holds, `$.session.usage()` does not;
//   2. the defaults the tests hold are the defaults `.claude-plugin/plugin.json` documents.
//   3. what the README says the braille map leaves out is what the inventory in `hooks/braille.test.tsx` leaves out.
// Run from the repository's root: `node scripts/check-surface.mjs` (add `--write` to rewrite surface.txt).
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const here = new URL('.', import.meta.url)
const fail = message => {
  console.error(`check-surface: ${message}`)
  process.exitCode = 1
}

// ---- 1. what the mod hooks and calls -----------------------------------------------------------------

// Every file of the mod itself: all of `hooks/` but the tests.
const SOURCES = readdirSync(new URL('../hooks/', here)).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).sort()
const sourceOf = file => readFileSync(new URL(`../hooks/${file}`, here), 'utf8')

/** Where the bracket opened at `from` closes, past strings and nested brackets. */
function closeOf(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++
    } else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth === 0) return i
  }
  return text.length
}

/** The parts of a list between brackets, split at its own commas. */
function partsOf(inner) {
  const parts = []
  let start = 0
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i]
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < inner.length && inner[i] !== c; i++) if (inner[i] === '\\') i++
    } else if (c !== undefined && '([{'.includes(c)) i = closeOf(inner, i)
    else if (c === ',' || c === undefined) {
      if (inner.slice(start, i).trim() !== '') parts.push(inner.slice(start, i).trim())
      start = i + 1
    }
  }
  return parts
}

/**
 * What each engine call is given first, one line a call and form: `{breakdown='summary'}` for an object written out,
 * with the values that are written as text; `('paneMin')` for a name written out; `(not written out)` for anything else,
 * so that an argument handed over in a variable still shows as a line of its own. A call given nothing has no line.
 */
function argumentsOf(files) {
  const lines = new Set()
  for (const file of files) {
    const text = sourceOf(file)
    for (const call of text.matchAll(/\$\.([a-z]+\.[A-Za-z]+)\(/g)) {
      const open = call.index + call[0].length - 1
      const first = partsOf(text.slice(open + 1, closeOf(text, open)))[0]
      if (first === undefined) continue
      let form = '(not written out)'
      if (/^'[^']*'$/.test(first)) form = `(${first})`
      else if (first.startsWith('{') && closeOf(first, 0) === first.length - 1)
        form = `{${partsOf(first.slice(1, -1)).map(part => {
          const field = /^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]*))?$/.exec(part)
          if (field === null) return part.startsWith('...') ? '...' : '?'
          return field[2] !== undefined && /^'[^']*'$/.test(field[2]) ? `${field[1]}=${field[2]}` : field[1]
        }).join(', ')}}`
      lines.add(`./${file} arguments: $.${call[1]}${form}`)
    }
  }
  return [...lines].sort()
}

const report = execFileSync(process.env.CLAUDE ?? 'claude', ['plugin', 'validate', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const KINDS = ['hooks', 'calls', 'env writes', 'env reads', 'state writes', 'state reads']
const surface = report
  .split('\n')
  // The validator marks a line with `❯`, and with `>` on a terminal that has no such letter, as under TERM=linux.
  .map(line => /^\s*[❯>] (\S+) (hooks|calls|env writes|env reads|state writes|state reads): (.*)$/.exec(line))
  .filter(Boolean)
  // One name per line, without the notes in brackets that differ between versions of Claude Code.
  .flatMap(([, file, kind, names]) => names.replace(/ \((?:via|default)[^)]*\)/g, '').split(/, (?![^{]*\})/).map(name => `${file} ${kind}: ${name}`))
  .sort((a, b) => KINDS.indexOf(a.split(' ').slice(1).join(' ').split(':')[0]) - KINDS.indexOf(b.split(' ').slice(1).join(' ').split(':')[0]) || a.localeCompare(b))
  .join('\n') + '\n' + argumentsOf(SOURCES).join('\n') + '\n'

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
for (const line of surface.split('\n')) if ((line.includes(' calls: ') || line.includes(' arguments: ')) && OUTSIDE.test(line)) fail(`a call that reaches outside the session: ${line}`)
for (const line of surface.split('\n')) if (/ hooks: (prompt\.compose|session\.append|tool\.describe|tool\.check)/.test(line)) fail(`a hook that can change what the model is sent or what is allowed: ${line}`)
if (/\b(fetch|XMLHttpRequest|WebSocket|require)\s*\(|\bimport\s*\(/.test(SOURCES.map(sourceOf).join('\n')))
  fail('the hooks module names fetch, a socket or a dynamic import')

// ---- 2. the defaults ---------------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', here), 'utf8'))
const documented = JSON.stringify(Object.fromEntries(Object.entries(manifest.userConfig).map(([name, field]) => [name, field.default])))
const held = /^const DEFAULTS = (\{.*\})$/m.exec(readFileSync(new URL('../hooks/principles.test.tsx', here), 'utf8'))?.[1]
if (held === undefined) fail('hooks/principles.test.tsx has no `const DEFAULTS = {…}` line')
else if (JSON.stringify(JSON.parse(held)) !== documented) fail(`the defaults in hooks/principles.test.tsx are not the manifest's. Set the line to:\nconst DEFAULTS = ${documented}`)

// ---- 3. what the braille map leaves out ---------------------------------------------------------------

const readme = readFileSync(new URL('../README.md', here), 'utf8')
const leftOut = [...readFileSync(new URL('../hooks/braille.test.tsx', here), 'utf8').matchAll(/leftOut: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map(m => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'))
if (leftOut.length === 0) fail('hooks/braille.test.tsx names nothing the braille map leaves out')
for (const words of leftOut) if (!readme.includes(words)) fail(`the README does not say that the braille map leaves out: ${words}`)
// The other way: every line of the README's list is one the inventory holds.
const list = /What it does not draw[^\n]*\n\n((?:- .*\n)+)/.exec(readme)?.[1]
if (list === undefined) fail('the README has no list under "What it does not draw"')
else for (const item of list.trim().split('\n')) if (!leftOut.some(words => item.includes(words))) fail(`the README says the braille map leaves out something the inventory in hooks/braille.test.tsx does not hold: ${item}`)

if (process.exitCode === undefined) console.log(`check-surface: ${surface.trim().split('\n').length} hooks and calls as listed, none reaching outside; ${Object.keys(manifest.userConfig).length} defaults as documented; ${leftOut.length} things the braille map leaves out as the README says`)
