// `contextCost`: what each call added to the context, on its row on every surface and as each station's sum on every drawing.
import { expect, test } from 'claude-code/testing'

import { paintBraille, rowsOf, sumsFit } from './braille'
import { charged, stepCosts } from './cost'
import { STATIONS, drawMap, formatTokens, foldRows, setupFrom } from './map'
import { hasGlyph, paint } from './raster'
import { parseMap } from './scene'
import type { Board, Entry } from '../types'

// The tests of cost print their figures. The types a mod is checked against have no console, so the tests name it.
declare const console: { log: (...args: unknown[]) => void }

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const COST = { contextCost: true } as const

/** A figure after a row's time, and not the `+4` a folded row carries after its words. */
const COST_FIGURE = /\d (?:ms|s) ~?\+\d/

type Kit = {
  /** The context the next reading will report, in tokens. */
  set: (tokens: number) => void
  /** One model step of the main loop, or of a subagent's. */
  step: (index: number, agentId?: string) => Promise<void>
  call: (tool: string, input?: Record<string, unknown>, agentId?: string) => Promise<void>
  done: () => Promise<void>
}

/** The engine beneath the mod: a clock that moves, a context the test sets, and steps and calls that answer at once. */
type Body = NonNullable<Parameters<typeof test>[2]>

function kit($: Parameters<Body>[0], on: Parameters<Body>[1]): Kit {
  let clock = 1_000_000
  let tokens = 10_000
  on('clock.now', () => ({ value: (clock += 7) }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: Math.round((tokens / 200_000) * 100), tokens } } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  on('session.compact', () => ({ skip: 'test' }) as never)
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  return {
    set: n => {
      tokens = n
    },
    step: async (index, agentId) => {
      for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1, ...(agentId !== undefined ? { agentId } : {}) } as never)) void _
    },
    call: async (tool, input = {}, agentId) => {
      await $.tool.call({ tool, ...input, ...(agentId !== undefined ? { agentId } : {}) } as never)
    },
    done: async () => {
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    },
  }
}

/** The text of the row whose words match, and of its time column. */
async function rowOf(ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> }, words: RegExp): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: words }))?.text
}

test('tokens are written short and whole, in every language alike', () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(420)).toBe('420')
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(1000)).toBe('1k')
  expect(formatTokens(42_400)).toBe('42k')
  expect(formatTokens(999_499)).toBe('999k')
  expect(formatTokens(999_600)).toBe('1M')
  expect(formatTokens(2_300_000)).toBe('2M')
  expect(formatTokens(-5)).toBe('0')
})

test('contextCost is off unless set to true, and off it adds no figure anywhere', async ($, on) => {
  expect(setupFrom({}).contextCost).toBe(false)
  expect(setupFrom({ contextCost: 'yes' }).contextCost).toBe(false)
  expect(setupFrom({ contextCost: true }).contextCost).toBe(true)
  expect(setupFrom({}).contextWindow).toBe('model')
  expect(setupFrom({ contextWindow: 'compaction' }).contextWindow).toBe('compaction')
  expect(setupFrom({ contextWindow: 'whole' }).contextWindow).toBe('model')

  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/big.ts' })
  k.set(52_000)
  await k.step(1)
  for (const surface of ['desktop', 'terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: COST_FIGURE })).toBeUndefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(' · 42k')
  await ui.unmount()
})

test('a call gets what the context grew by, one step late, on its row on every surface', { options: COST }, async ($, on) => {
  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/big.ts' })

  // Not yet: the reading that holds the call's answer is the next step's.
  const before = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await rowOf(before, /b\/big\.ts/)).not.toMatch(/\+/)
  expect(await before.find({ type: 'Text', text: /\+42k/ })).toBeUndefined()
  await before.unmount()

  k.set(52_000)
  await k.step(1)
  for (const surface of ['desktop', 'terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // The figure stands after the time, in the same text and so in the same colour as the time.
    const time = await ui.find({ type: 'Text', text: /ms \+42k$/ })
    expect(time?.text).toMatch(/^\d+ ms \+42k$/)
    await ui.unmount()
  }
})

test('each station\'s sum stands after its count on the desktop map, on the editor\'s, and on the terminal\'s line of counts', { options: COST }, async ($, on) => {
  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/big.ts' })
  k.set(52_000)
  await k.step(1)
  await k.call('Read', { file_path: '/a/b/other.ts' })
  k.set(60_000)
  await k.step(2)

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Two reads at Files: 42k and 8k.
  expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('>2 · 50k</text>')
  await desk.unmount()
  const editor = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(String((await editor.find({ type: 'Svg' }))?.props.source)).toContain('>2 · 50k</text>')
  await editor.unmount()
  // A terminal with the rows alone has no drawing: the sum goes after the count in the line of counts, as braille writes it.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Files 2 \+50k/ }))?.text).toMatch(/Model \d+ · Files 2 \+50k$/)
  await term.unmount()
})

test('the terminal picture is painted from the drawing with the sums on it, and the painter knows every letter of them', () => {
  const now = 1_000_000
  const board: Board = { entries: [], counts: { files: 12, memory: 3, shell: 4 }, pushed: 2, spent: { files: 1_234_000, memory: 9000, shell: 420 } }
  const setup = setupFrom({ theme: 'dark', contextCost: true })
  const scene = parseMap(drawMap(board, now, setup))
  expect(scene.unknown).toEqual([])
  for (const letter of '0123456789kM· ') expect([letter, hasGlyph(letter)]).toEqual([letter, true])
  // The sums are part of the picture: the same board without them paints other pixels.
  const withSums = paint(scene, 0, 1).rgba.slice()
  const without = paint(parseMap(drawMap({ ...board, spent: {} }, now, setup)), 0, 1).rgba
  expect(withSums.some((value, i) => value !== without[i])).toBe(true)
})

test('the station sum takes the count line\'s own colour, which the light rules repaint, on any theme', () => {
  const now = 1_000_000
  const entry: Entry = { id: 'a', station: 'files', label: 'x', from: 'core', startedAt: now - 60_000, endedAt: now - 59_000, status: 'ok', tokens: 42_000 }
  const board: Board = { entries: [entry], counts: { files: 1, memory: 3 }, pushed: 2, spent: { files: 42_000, memory: 9000 } }
  const dark = drawMap(board, now, setupFrom({ theme: 'dark', contextCost: true }))
  expect(dark).toContain('fill="#6b7280">1 · 42k</text>')
  expect(drawMap(board, now, setupFrom({ theme: 'light', contextCost: true }))).toContain('fill="#8b909a">1 · 42k</text>')
  // Under auto the dark drawing goes with rules that repaint every palette colour on a light surface: this one too.
  const auto = drawMap(board, now, setupFrom({ contextCost: true }))
  expect(auto).toContain('[fill="#6b7280"]{fill:#8b909a}')
  expect(auto).toContain('fill="#6b7280">1 · 42k</text>')
  // A colour of the person's own holds.
  expect(drawMap(board, now, setupFrom({ contextCost: true, colors: 'faint=#123456' }))).toContain('fill="#123456">1 · 42k</text>')
  // Memory keeps its two counts first.
  expect(dark).toMatch(/1 <tspan fill="#62c7ba">↓2<\/tspan> · 9k<\/text>/)
  // Without the option the line is the count alone.
  expect(drawMap(board, now, setupFrom({ theme: 'dark' }))).toContain('fill="#6b7280">1</text>')
})

// ---- the sums on the braille map -------------------------------------------------------------------

const SPENT: Board = {
  entries: [],
  counts: { you: 4, model: 31, files: 12, shell: 48, web: 7, memory: 5, agents: 2 },
  spent: { files: 182_000, shell: 9400, web: 61_000, memory: 12_000, agents: 38_000 },
  faults: { web: 1 },
}

/** The colour each letter of the grid is written in, by the row's text. */
function inkAt(cells: ReturnType<typeof paintBraille>, words: string): number[] {
  const text = rowsOf(cells).map(row => row.padEnd(cells.columns)).join('')
  const at = text.indexOf(words)
  return at < 0 ? [] : [...words].map((_, k) => cells.ink[at + k] ?? -1)
}

test('the braille map writes each station\'s sum after its count, in the colour of the name it stands beside', () => {
  for (const options of [{ theme: 'dark' }, { theme: 'light' }, { background: 'transparent' }, { theme: 'light', background: 'transparent' }, { colors: 'label=#445566' }]) {
    const cells = paintBraille(SPENT, 1_000_000, setupFrom({ ...options, contextCost: true }), 60, 21)
    const grid = rowsOf(cells).join('\n')
    expect(grid).toContain('Files 12 +182k')
    expect(grid).toContain('Shell 48 +9k')
    expect(grid).toContain('Memory 5 +12k')
    // What went wrong keeps its place after the sum.
    expect(grid).toContain('Network 7 +61k !1')
    // A station that took calls and added nothing that was read has its count alone.
    expect(grid).toMatch(/Model 31(?! \d)/)
    // One colour from the first letter of the name to the last of the sum: whatever reads for the name reads for the sum.
    expect(new Set(inkAt(cells, 'Files 12 +182k')).size).toBe(1)
  }
  // Without the option, no sum.
  expect(rowsOf(paintBraille(SPENT, 1_000_000, setupFrom({}), 60, 21)).join('\n')).toMatch(/Files 12(?! [\d+])/)
})

test('a sum under a thousand stands apart from its count by its plus, on the braille map and in the line of counts', { options: COST }, async ($, on) => {
  // `Files 3 690` would read as three thousand six hundred and ninety.
  const small: Board = { entries: [], counts: { files: 3, shell: 1, web: 7 }, spent: { files: 690, shell: 104, web: 61_000 }, faults: { web: 1 } }
  const grid = rowsOf(paintBraille(small, 1_000_000, setupFrom({ contextCost: true }), 60, 21)).join('\n')
  expect(grid).toContain('Files 3 +690')
  expect(grid).toContain('Shell 1 +104')
  expect(grid).toContain('Network 7 +61k !1')
  expect(grid).not.toMatch(/\d \d/)

  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/small.ts' })
  k.set(10_690)
  await k.step(1)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Files 1 \+690/ }))?.text).toMatch(/Files 1 \+690$/)
  await term.unmount()
})

test('where a grid has no room for every station\'s sum the braille map draws none of them, and keeps every name whole', () => {
  const setup = setupFrom({ contextCost: true })
  // Counts of three digits at every station need more room than fifty columns give.
  const crowded: Board = { ...SPENT, counts: Object.fromEntries(STATIONS.map(s => [s.id, 888])), spent: Object.fromEntries(STATIONS.map(s => [s.id, 123_000])) }
  expect(sumsFit(setup, 50, 21, crowded.counts)).toBe(false)
  const narrow = rowsOf(paintBraille(crowded, 1_000_000, setup, 50, 21)).join('\n')
  expect(narrow).not.toContain('123k')
  for (const name of Object.values(setup.t.stations)) expect(narrow).toContain(`${name} 888`)
  // The widest grid has the room, for the same board.
  expect(sumsFit(setup, 76, 21, crowded.counts)).toBe(true)
  const wide = rowsOf(paintBraille(crowded, 1_000_000, setup, 76, 21)).join('\n')
  for (const name of Object.values(setup.t.stations)) expect(wide).toContain(`${name} 888 +123k`)
  // It goes by the room the widest sum would take, so a sum that grows never takes the others away.
  expect(sumsFit(setup, 60, 21, SPENT.counts)).toBe(true)
  for (const tokens of [1, 999, 1000, 999_000, 5_000_000]) {
    expect(rowsOf(paintBraille({ ...SPENT, spent: { files: tokens } }, 1_000_000, setup, 60, 21)).join('\n')).toContain(`Files 12 +${formatTokens(tokens)}`)
  }
})

test('a few calls in one step share its growth evenly and are marked; many get no figure', { options: COST }, async ($, on) => {
  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/one.ts' })
  await k.call('Bash', { command: 'make', description: 'Build it' })
  k.set(52_000)
  await k.step(1)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /~\+21k$/ }))?.text).toMatch(/~\+21k$/)
  await term.unmount()

  // Five calls at three stations: a share would say a short command cost as much as a large read.
  for (const [tool, input] of [['Read', { file_path: '/a/b/c.ts' }], ['Bash', { command: 'ls', description: 'List' }], ['WebFetch', { url: 'https://example.com/x' }], ['Grep', { pattern: 'x' }], ['Read', { file_path: '/a/b/d.ts' }]] as const) {
    await k.call(tool, input)
  }
  k.set(152_000)
  await k.step(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\+20k$/ })).toBeUndefined()
  // Files keeps the 21k of the first step and gets nothing of this one.
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('· 21k</text>')
  await ui.unmount()
})

test('many calls at one station give their rows no figure, but the station its whole sum', { options: COST }, async ($, on) => {
  const k = kit($, on)
  await k.step(0)
  for (const name of ['a', 'b', 'c', 'd', 'e']) await k.call('Read', { file_path: `/x/y/${name}.ts` })
  k.set(110_000)
  await k.step(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: COST_FIGURE })).toBeUndefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('>5 · 100k</text>')
  await ui.unmount()
})

test('a call whose step was the last of its turn, one before a compaction and a subagent\'s call get no figure', { options: COST }, async ($, on) => {
  const k = kit($, on)
  await k.step(0)
  await k.call('Read', { file_path: '/a/b/last.ts' })
  // The turn ends without another step: the next reading is the next turn's, with the next message in it.
  await k.done()
  k.set(80_000)
  await k.step(0)

  await k.call('Read', { file_path: '/a/b/before.ts' })
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'kept', toolUses: [] }] } as never)
  k.set(20_000)
  await k.step(1)
  // Smaller than before: the context shrank, and nothing is put anywhere.
  await k.call('Read', { file_path: '/a/b/after.ts' })
  k.set(15_000)
  await k.step(2)

  // A subagent's call fills its own context, which the engine does not report.
  await k.call('Read', { file_path: '/a/b/sub.ts' }, 'a1')
  k.set(30_000)
  await k.step(3)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const name of [/last\.ts/, /before\.ts/, /after\.ts/, /sub\.ts/]) expect(await rowOf(ui, name)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: COST_FIGURE })).toBeUndefined()
  await ui.unmount()
})

test('the order of a step is kept apart from the engine: a call is answered by the next step, and charged with that step\'s growth', () => {
  const call = (id: string, station: Entry['station']): Entry => ({ id, station, label: id, from: 'core', startedAt: 0, endedAt: 1, status: 'ok' })
  const costs = stepCosts(true)
  // The first step answers no call and only sets the mark.
  const first = costs.stepEnded(costs.stepStarted(), 10_000)
  expect(first).toEqual({ calls: [], before: undefined, after: 10_000 })
  costs.called('a')
  const second = costs.stepEnded(costs.stepStarted(), 14_000)
  expect(second).toEqual({ calls: ['a'], before: 10_000, after: 14_000 })
  const board: Board = { entries: [call('a', 'files'), call('b', 'shell')], counts: {} }
  const after = charged(board, second?.calls ?? [], second?.before, second?.after)
  expect(after.entries.map(e => e.tokens)).toEqual([4000, undefined])
  expect(after.spent).toEqual({ files: 4000 })
  // A call made in the turn's last step, and one made before a compaction, are answered by no step.
  costs.called('b')
  costs.turnEnded()
  expect(costs.stepStarted()).toEqual([])
  costs.called('c')
  costs.compacted()
  expect(costs.stepEnded(costs.stepStarted(), 3000)).toEqual({ calls: [], before: undefined, after: 3000 })
  // Nothing to put anywhere leaves the board as it was: no reading before, a context that shrank, a call not on the board.
  expect(charged(board, ['a'], undefined, 5000)).toBe(board)
  expect(charged(board, ['a'], 5000, 4000)).toBe(board)
  expect(charged(board, ['gone'], 1000, 5000)).toBe(board)
  // Off, it keeps nothing and no step has anything to put.
  const off = stepCosts(false)
  off.called('a')
  expect(off.stepStarted()).toEqual([])
  expect(off.stepEnded([], 5000)).toBeUndefined()
})

test('a folded row sums its calls\' figures, and is marked when some of them have none', () => {
  const at = (id: string, startedAt: number, more: Partial<Entry>): Entry => ({ id, station: 'files', label: id, from: 'core', startedAt, endedAt: startedAt + 5, status: 'ok', ...more })
  const whole = foldRows([at('a', 1, { tokens: 2000 }), at('b', 10, { tokens: 3000 })])[0]
  expect([whole?.times, whole?.tokens, whole?.isShared]).toEqual([2, 5000, undefined])
  const part = foldRows([at('a', 1, {}), at('b', 10, { tokens: 3000 })])[0]
  expect([part?.times, part?.tokens, part?.isShared]).toEqual([2, 3000, true])
  const none = foldRows([at('a', 1, {}), at('b', 10, {})])[0]
  expect([none?.tokens, none?.isShared]).toEqual([undefined, undefined])
  expect(foldRows([at('a', 1, { tokens: 700, shared: true })])[0]?.isShared).toBe(true)
})

// ---- what it costs ---------------------------------------------------------------------------------

test('principle 3: a step that answers forty calls costs about what a step that answers none does', { options: COST, timeoutMs: 30_000 }, async ($, on) => {
  const k = kit($, on)
  let tokens = 10_000
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
  const timedStep = async (calls: number, index: number): Promise<number> => {
    for (let i = 0; i < calls; i++) await k.call('Read', { file_path: `/x/y/f${index}-${i}.ts` })
    k.set((tokens += 5000))
    const started = performance.now()
    await k.step(index)
    return performance.now() - started
  }
  // A warm-up, then each kind of step twenty times.
  for (let i = 0; i < 20; i++) await timedStep(i % 2 === 0 ? 0 : 40, i)
  const bare: number[] = []
  const busy: number[] = []
  for (let i = 0; i < 20; i++) {
    bare.push(await timedStep(0, 100 + 2 * i))
    busy.push(await timedStep(40, 101 + 2 * i))
  }
  console.log(`COST a model step through the mod and the test kit, with contextCost: answering no call ${median(bare).toFixed(2)}ms, answering forty ${median(busy).toFixed(2)}ms`)
  expect(median(busy)).toBeLessThan(15)
  expect(median(busy)).toBeLessThan(median(bare) * 3 + 2)
})

/** The engine for the ring's window: 450k tokens in a 1M window, and what `breakdown` answers per model, counted. */
function windowKit($: Parameters<Body>[0], on: Parameters<Body>[1], breakdowns: Record<string, { rawMaxTokens: number; isAutoCompactEnabled: boolean } | undefined>) {
  const asked: unknown[] = []
  let model = 'claude-opus-5-5'
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.usage', (_, args) => {
    const breakdown = (args as { breakdown?: string } | undefined)?.breakdown
    if (breakdown !== undefined) asked.push(breakdown)
    const context = { window: 1_000_000, percent: 45, tokens: 450_000 }
    return { value: { startedAt: 0, context: breakdown === undefined || breakdowns[model] === undefined ? context : { ...context, breakdown: breakdowns[model] } } } as never
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  on('session.compact', () => ({ skip: 'test' }) as never)
  return {
    asked,
    step: async (to: string, agentId?: string) => {
      model = to
      for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: to, messageCount: 1, ...(agentId !== undefined ? { agentId } : {}) } as never)) void _
    },
    compact: (trigger: string, agentId?: string) =>
      $.session.compact({ trigger, messages: [{ role: 'user', text: 'kept', toolUses: [] }], ...(agentId !== undefined ? { agentId } : {}) } as never),
    ring: async (): Promise<string> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
      const source = String((await ui.find({ type: 'Svg' }))?.props.source)
      await ui.unmount()
      return source
    },
  }
}

const A = 'claude-opus-5-5'
const B = 'claude-fable-5-2'
const on600 = { rawMaxTokens: 600_000, isAutoCompactEnabled: true }
const on500 = { rawMaxTokens: 500_000, isAutoCompactEnabled: true }

test('with contextWindow compaction the ring measures against the auto-compact window, asked only at a session\'s first step, after a compaction and on a model change', { options: { contextWindow: 'compaction' } }, async ($, on) => {
  const k = windowKit($, on, { [A]: on600, [B]: on500 })
  await k.step(A)
  expect(k.asked).toHaveLength(1)
  expect(await k.ring()).toContain('>75%<')

  // Another step on the same model and every drawing of the pane ask nothing.
  await k.step(A)
  for (const _ of [1, 2, 3]) await k.ring()
  expect(k.asked).toHaveLength(1)

  await k.step(B)
  expect(k.asked).toHaveLength(2)
  expect(await k.ring()).toContain('>90%<')

  await k.compact('auto')
  await k.step(B)
  expect(k.asked).toHaveLength(3)

  // A compaction that installs nothing, and a subagent's, are not the main window's.
  await k.compact('precompute')
  await k.compact('auto', 'a1')
  await k.step(B)
  await k.step('claude-haiku-5-5', 'a1')
  expect(k.asked).toHaveLength(3)
  expect(k.asked.every(detail => detail === 'summary')).toBe(true)
})

test('by default the ring measures against the model\'s window and the heavy call is never made', async ($, on) => {
  const k = windowKit($, on, { [A]: on600, [B]: on500 })
  await k.step(A)
  await k.step(B)
  await k.compact('auto')
  await k.step(B)
  expect(k.asked).toHaveLength(0)
  expect(await k.ring()).toContain('>45%<')
})

test('with contextWindow compaction the ring keeps the model\'s window when there is no smaller one to measure against', { options: { contextWindow: 'compaction' } }, async ($, on) => {
  // One model for each case, so that each is measured anew.
  const k = windowKit($, on, {
    [A]: undefined,
    [B]: { rawMaxTokens: 1_000_000, isAutoCompactEnabled: true },
    'claude-haiku-5-5': { rawMaxTokens: 600_000, isAutoCompactEnabled: false },
  })
  for (const model of [A, B, 'claude-haiku-5-5']) {
    await k.step(model)
    expect(await k.ring()).toContain('>45%<')
  }
  expect(k.asked).toHaveLength(3)
})

test('with contextWindow compaction the ring rounds to a whole percentage and stays full past the window', { options: { contextWindow: 'compaction' } }, async ($, on) => {
  const k = windowKit($, on, {
    [A]: { rawMaxTokens: 700_000, isAutoCompactEnabled: true },
    [B]: { rawMaxTokens: 400_000, isAutoCompactEnabled: true },
  })
  await k.step(A)
  expect(await k.ring()).toContain('>64%<')
  await k.step(B)
  expect(await k.ring()).toContain('>100%<')
  expect(k.asked).toHaveLength(2)
})
