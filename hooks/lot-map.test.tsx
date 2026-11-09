import { expect, test } from 'claude-code/testing'

import type { Board } from '../types'
import { classify, drawMap, firstLine, formatMs, memoryIds, setupFrom } from './map'
import { stringsFor } from './text'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Someone's own setup as it stands in settings: Russian labels and a memory of their own.
const OWN = {
  language: 'ru',
  coreName: 'ДОМ',
  memoryServers: ['recall'],
  memoryCommands: ['recall', 'check_recall'],
  memoryPaths: ['/.recall/'],
  memoryLabels: ['search=поиск', 'get_note=чтение записи'],
  hookRecords: true,
} as const
const SETUP = setupFrom(OWN)
const STRANGER = setupFrom({ language: 'en', coreName: 'CLAUDE', memoryServers: ['memory'], hookRecords: false })

test('every kind of call lands on its station', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).station
  expect(at('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(at('Bash', { command: 'python3 ~/.claude/scripts/recall-sync.py --apply' })).toBe('memory')
  expect(at('Bash', { command: 'python3 scripts/check_recall.py' })).toBe('memory')
  expect(at('Bash', { command: 'D=/tmp; cat $D/a | grep x; echo done' })).toBe('files')
  expect(at('Bash', { command: 'cat ~/.claude/projects/-Users-a/memory/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'cat ~/.recall/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'git push origin main' })).toBe('web')
  expect(at('Bash', { command: 'gh pr list' })).toBe('web')
  expect(at('Bash', { command: 'git status' })).toBe('shell')
  expect(at('Bash', { command: 'python3 _src/build.py' })).toBe('shell')
  expect(at('Read', { file_path: '/a/b/c/content.py' })).toBe('files')
  expect(at('Grep', { pattern: 'x' })).toBe('files')
  expect(at('Glob', { pattern: 'x' })).toBe('files')
  expect(at('Edit', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('mcp__recall__search', { query: 'x' })).toBe('memory')
  expect(at('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' })).toBe('browser')
  expect(at('WebFetch', { url: 'https://a.b/c' })).toBe('web')
  expect(at('Agent', { description: 'x' })).toBe('agents')
  expect(at('Skill', { skill: 'pdf' })).toBe('skills')
  expect(at('AskUserQuestion', {})).toBe('you')
})

test('out of the box, memory is only what every install has', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, STRANGER).station
  expect(at('Read', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('Read', { file_path: '/Users/a/.recall/n.md' })).toBe('files')
  expect(at('mcp__memory__search_nodes', {})).toBe('memory')
  expect(at('mcp__recall__search', {})).toBe('web')
  expect(at('Bash', { command: 'recall memory journal' })).toBe('shell')
  expect(classify('mcp__memory__search_nodes', {}, STRANGER).label).toBe('search nodes')
})

test('labels never carry what was written or searched', () => {
  const label = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).label
  expect(label('Read', { file_path: '/a/b/c/content.py' })).toBe('c/content.py')
  expect(label('Bash', { command: 'recall add "private text" --category journal' })).toBe('add')
  expect(label('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(label('Bash', { command: 'recall add private words here' })).toBe('add')
  expect(label('Bash', { command: 'recall "private text"' })).toBe('recall')
  expect(label('mcp__recall__search', { query: 'private' })).toBe('поиск')
  expect(label('mcp__recall__get_note', { id: 7 })).toBe('чтение записи #7')
  expect(label('WebFetch', { url: 'https://a.b/secret?x=1' })).toBe('a.b')
  expect(label('WebFetch', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('WebFetch', { url: 'a.b/reset?token=private' })).toBe('a.b')
  expect(label('WebFetch', { url: 'file:///Users/a/private.txt' })).toBe('file')
  expect(label('mcp__Claude_Browser__navigate', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('Grep', { pattern: 'private' })).toBe('Grep')
  expect(label('WebSearch', { query: 'private' })).toBe('поиск в сети')
})

test('hook helpers', () => {
  expect(memoryIds('• [#1971 excerpt] and [now #45] and [todo #3] and [#1971 again]')).toEqual(['1971', '45', '3'])
  expect(firstLine('\nBlocked by x: rule.\nCommand: secret')).toBe('Blocked by x: rule.')
  expect(formatMs(1500, stringsFor('en'))).toBe('1.5 s')
  expect(formatMs(1500, stringsFor('ru'))).toBe('1.5 с')
  expect(formatMs(1500, stringsFor('de'))).toBe('1,5 s')
  expect(stringsFor('en').records(1, '#7')).toBe('1 record: #7')
  expect(stringsFor('en').stations.web).toBe('Network')
})

const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de'] as const

test('every language has every word, in a table of its own', () => {
  const en = stringsFor('en')
  for (const language of LANGUAGES) {
    const t = stringsFor(language)
    expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(t.stations).sort()).toEqual(Object.keys(en.stations).sort())
    expect(Object.values(t.stations).every(name => name !== '')).toBe(true)
  }
  expect(new Set(LANGUAGES.map(language => stringsFor(language).title)).size).toBe(LANGUAGES.length)
  expect(stringsFor('constructor').title).toBe(en.title)
})

for (const [language, row] of [['es', 'Archivos  b/content.py'], ['fr', 'Fichiers   b/content.py'], ['de', 'Dateien    b/content.py']] as const) {
  test(`the pane speaks ${language}, its columns even`, { options: { language } }, async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain(row)
    await ui.unmount()
  })
}

test('options that make no sense count as not set', () => {
  const odd = setupFrom({ language: 'xx', coreName: '   ', memoryServers: 7, memoryLabels: ['no-equals', '=x', 'y='], hookRecords: 'yes' })
  expect(odd.t.idle).toBe(stringsFor('en').idle)
  expect(odd.core).toBe('CLAUDE')
  expect(odd.memoryServers.size).toBe(0)
  expect(odd.memoryLabels.size).toBe(0)
  expect(odd.hookRecords).toBe(false)
})

test('a long name shrinks inside the core and cannot break the drawing', () => {
  const svg = (name: string) => drawMap({ entries: [], counts: {} }, 1000, setupFrom({ coreName: name }))
  expect(svg('A<B&"C"DEFGHIJK')).toContain('A&lt;B&amp;&quot;C&quot;DEF<')
  expect(svg('ABC')).toContain('font-size="17" letter-spacing="2.5"')
  expect(svg('CLAUDE')).toContain('font-size="13.8"')
  expect(svg('')).toContain('>CLAUDE<')
})

test('the drawing stays within what Svg accepts at its fullest', () => {
  const now = 1_000_000
  const stations = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills', 'hooks'] as const
  const board: Board = {
    model: 'claude-opus-5-5',
    step: 12,
    counts: { files: 12345 },
    entries: Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      station: stations[i % stations.length],
      label: 'x'.repeat(70),
      from: 'core' as const,
      startedAt: now - 100 - i,
      status: 'run' as const,
    })),
  }
  const svg = drawMap(board, now, SETUP)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('<animateMotion')
  expect(svg).toContain('opus 5.5')
  expect(svg).not.toContain('xxxxx')
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('Infinity')
})

test('with no options set the map speaks English and shows no record numbers', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {} }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#12 excerpt] text of a note'] }))

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  await $.tool.call({ tool: 'Bash', command: 'recall add note', description: 'Save a note' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /[а-яё]/i })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /added context to the message/ }))?.text).toContain('Hooks')
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')
    expect((await ui.find({ type: 'Text', text: /Save a note/ }))?.text).toContain('Shell')
    expect(await ui.find({ type: 'Text', text: /#12/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a call shows on the pane, on every surface', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы')
    await ui.unmount()
  }
})

test('a call a settings hook refused reads as blocked, with the hook lit', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: нельзя\nCommand: secret' }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /JUDGE/ }))?.text).toContain('Хуки')
  expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toContain('✕')
  expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined()
  await ui.unmount()
})

test('memory a hook adds shows as numbers, never as its text', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#1971 excerpt] тайный текст записи\n• [#277 excerpt] ещё'] }))

  await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /записей 2/ }))?.text).toContain('#1971 #277')
  expect(await ui.find({ type: 'Text', text: /тайный/ })).toBeUndefined()
  await ui.unmount()
})

test('a broken board never stops the tool', async ($, on) => {
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
  on('tool.call', () => ({ result: { ok: true } }))

  const ran = await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ ok: true })
})

test('what an earlier version stored is declined', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('state.get', () => ({ value: { value: { rows: 1 }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Пока ничего/ }))?.text).toBe('Пока ничего не было.')
  await ui.unmount()
})

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as const

test('a model step streams through untouched and shows on the map', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'первый' } as never
    yield { kind: 'text', index: 0, text: 'второй' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  const stream = $.turn.step(STEP)
  for await (const chunk of stream) seen.push(chunk)
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'первый' }, { kind: 'text', index: 0, text: 'второй' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /шаг 1/ })
  expect(row?.text).toContain('Модель')
  expect(row?.text).toContain('opus 5.5')
  await ui.unmount()
})

test('a broken board never stops a model step', async ($, on) => {
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
  on('clock.now', () => { throw new Error('no clock') })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'дошло' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  for await (const chunk of $.turn.step(STEP)) seen.push(chunk)
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'дошло' }])
})

test('the end of a turn settles a call that never reported back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'и всё' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  // A step that was never read to its end stays "running", as an interrupted call does.
  const hanging = $.turn.step(STEP)[Symbol.asyncIterator]()
  await hanging.next()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ход прерван/ }))?.text).toContain('Ты')
  expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  await ui.unmount()
})
