// What PRINCIPLES.md promises, held by tests. A principle that has no test here is named there as unproven.
import { expect, test } from 'claude-code/testing'

import type { Board } from '../types'
import { STATIONS, classify, clean, drawMap, foldRows, setupFrom } from './map'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const PLAIN = setupFrom({})

/** A conversation of one message: a compaction takes and leaves at least one. */
const TALK = [{ role: 'user', text: 'kept', toolUses: [] }]

// prettier-ignore
const DEFAULTS = {"language":"en","coreName":"CLAUDE","memoryServers":["memory"],"memoryCommands":[],"memorySubcommands":[],"memoryPaths":[],"memoryLabels":[],"hookRecords":false,"hookReasons":false,"theme":"auto","background":"solid","colors":[],"layout":"you-top","motion":"full","textSize":"footnote","terminalView":"text","cellShape":2.4}

// ---- 1. It watches and changes nothing ------------------------------------------------------------

test('principle 1: every hook hands on the event it was given and returns what came back', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const got: Record<string, unknown> = {}
  const back: Record<string, object> = {
    'tool.call': { result: { stdout: 'kept' } },
    'prompt.submit': { text: 'kept' },
    'classic.UserPromptSubmit': { additionalContext: ['kept'] },
    'classic.SessionStart': { additionalContext: ['kept'] },
    'skill.prompt': { text: 'kept' },
    'session.compact': { skip: 'kept' },
    'turn.start': { turnId: 'kept' },
    'turn.complete': { text: 'kept' },
  }
  for (const event of Object.keys(back)) on(event as never, ((_: unknown, e: unknown) => ((got[event] = e), back[event])) as never)
  // The settings hooks' check before a tool rides the tool call; what it is handed is the call.
  on('classic.PreToolUse', ((_: unknown, e: unknown) => ((got['classic.PreToolUse'] = e), {})) as never)

  const sent: Record<string, Record<string, unknown>> = {
    'tool.call': { tool: 'Bash', command: 'make', description: 'Build' },
    'prompt.submit': { text: 'hello' },
    'classic.UserPromptSubmit': { prompt: 'hello', permission_mode: 'default' },
    'classic.SessionStart': { source: 'startup' },
    'skill.prompt': { skill: 'pdf', text: 'body' },
    'session.compact': { trigger: 'manual', messages: TALK },
    'turn.start': { text: 'hello', turnId: 't1' },
    'turn.complete': { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end' },
  }
  const fire: Record<string, (e: never) => Promise<unknown>> = {
    'tool.call': e => $.tool.call(e),
    'prompt.submit': e => $.prompt.submit(e),
    'classic.UserPromptSubmit': e => $.classic.UserPromptSubmit(e),
    'classic.SessionStart': e => $.classic.SessionStart(e),
    'skill.prompt': e => $.skill.prompt(e),
    'session.compact': e => $.session.compact(e),
    'turn.start': e => $.turn.start(e),
    'turn.complete': e => $.turn.complete(e),
  }

  for (const event of Object.keys(back)) {
    const returned = await fire[event]?.(sent[event] as never)
    expect([event, got[event]]).toEqual([event, expect.objectContaining(sent[event] ?? {})])
    expect([event, returned]).toEqual([event, expect.objectContaining(back[event] ?? {})])
  }
  expect(got['classic.PreToolUse']).toEqual(expect.objectContaining({ tool: 'Bash', command: 'make' }))
})

test('principle 1: a refusal comes back as it was written, from a plugin beneath or from a settings hook', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  let refuses: 'plugin' | 'settings' = 'plugin'
  on('tool.call', () => (refuses === 'plugin' ? { deny: 'kept as written' } : { result: {} }))
  on('classic.PreToolUse', () => (refuses === 'settings' ? { deny: 'kept as written' } : {}))

  expect((await $.tool.call({ tool: 'Bash', command: 'make' })).deny).toBe('kept as written')
  refuses = 'settings'
  expect(await $.tool.call({ tool: 'Bash', command: 'make' })).toEqual(expect.objectContaining({ isError: true, text: 'kept as written' }))
})

// ---- 2. A label holds a name, never content ---------------------------------------------------------

const MARK = 'PRIVATE7Q'

/** Every field a call may carry, with the mark wherever content goes. A path keeps its last two parts and an address its host, so the mark sits before them. */
const loaded = (more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: `curl -H "token: ${MARK}" https://a.b/${MARK}`,
  file_path: `/Users/${MARK}/work/src/main.py`,
  path: `/Users/${MARK}/work/src`,
  notebook_path: `/Users/${MARK}/work/src/book.ipynb`,
  url: `https://user:${MARK}@a.b/${MARK}?q=${MARK}#${MARK}`,
  pattern: MARK,
  query: MARK,
  content: MARK,
  old_string: MARK,
  new_string: MARK,
  prompt: MARK,
  text: MARK,
  message: MARK,
  subject: MARK,
  plan: MARK,
  body: MARK,
  title: MARK,
  questions: [{ question: MARK }],
  files: [`/Users/${MARK}/a.txt`],
  script: MARK,
  args: MARK,
  ...more,
})

// The labels that are words the model wrote for the row: a command's, a monitor's and a subagent's short description.
// README and PRIVACY.md say so. Everything else is a name.
const WRITTEN_FOR_THE_ROW = new Set(['Bash', 'PowerShell', 'Monitor', 'Agent'])

const TOOLS = [
  'Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Artifact', 'ArtifactComments', 'ArtifactData',
  'SendToProject', 'SendToProjectContext', 'Agent', 'Monitor', 'Workflow', 'SendMessage', 'TaskStop', 'ListAgents', 'CronCreate', 'CronDelete', 'CronList',
  'ScheduleWakeup', 'RemoteTrigger', 'Skill', 'ToolSearch', 'ListSkills', 'SearchSkills', 'SuggestSkills', 'ListPlugins', 'SearchPlugins', 'SuggestPluginInstall',
  'AskUserQuestion', 'SendUserFile', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'PushNotification',
  'ReportFindings', 'EnterWorktree', 'ExitWorktree', 'SomeToolOfTomorrow', 'mcp__memory__search', 'mcp__Claude_Browser__navigate', 'mcp__claude-in-chrome__navigate',
  'mcp__remote-devices__Claude_Browser__navigate', 'mcp__terminal__run_in_terminal', 'mcp__visualize__show_widget', 'mcp__ccd_turn__update_plan',
  'mcp__plugin-authoring__scan_secrets', 'mcp__some_server__some_tool',
]

const inputFor = (tool: string): Record<string, unknown> =>
  loaded({ description: WRITTEN_FOR_THE_ROW.has(tool) ? 'Fetch the page' : MARK, skill: tool === 'Skill' ? 'pdf' : MARK, id: `${MARK} and more words than an id has` })

test('principle 2: no tool puts content on its label, whatever its input carries', () => {
  for (const tool of TOOLS) expect(`${tool}: ${classify(tool, inputFor(tool), PLAIN).label}`).not.toContain(MARK)
})

test('principle 2: nothing a session carries reaches what the mod keeps or draws', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const kept: unknown[] = []
  for (const write of ['state.set', 'store.set']) on(write as never, ((_: unknown, e: unknown, next: (e: unknown) => unknown) => (kept.push(e), next(e))) as never)
  on('tool.call', () => ({ result: { stdout: MARK, content: MARK } }) as never)
  on('classic.PreToolUse', () => ({ deny: `refused because of ${MARK}` }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: [`[#12 note] ${MARK}`] }))
  on('classic.SessionStart', () => ({ additionalContext: [MARK] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)

  await $.turn.start({ text: MARK, turnId: 't1' } as never)
  await $.prompt.submit({ text: MARK } as never)
  await $.classic.UserPromptSubmit({ prompt: MARK, permission_mode: 'default' } as never)
  await $.classic.SessionStart({ source: 'startup' } as never)
  for (const tool of TOOLS) await $.tool.call({ tool, ...inputFor(tool) } as never)

  // Everything the mod wrote to the session's state and to its store, in every version it passed through.
  const written = JSON.stringify(kept)
  expect(written).toContain('src/main.py')
  expect(written).not.toContain(MARK)
  const labels = kept.flatMap(e => ((e as { value?: { value?: Board } }).value?.value?.entries ?? []).map(x => x.label))
  expect(labels.length).toBeGreaterThan(TOOLS.length)
  for (const label of labels) expect(label.length).toBeLessThanOrEqual(120)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: new RegExp(MARK) })).toBeUndefined()
  await ui.unmount()
})

// ---- 3. It costs next to nothing --------------------------------------------------------------------

// Each budget is many times what was measured (PRINCIPLES.md has the figures and the machine), so that a slow
// runner passes and only a change of kind fails: a scan that grew with the session, a drawing that doubled.
const now = (): number => performance.now()
const timed = (times: number, work: (i: number) => void): number => {
  for (let i = 0; i < Math.min(200, times); i++) work(i)
  const started = now()
  for (let i = 0; i < times; i++) work(i)
  return (now() - started) / times
}

const ORDINARY: [string, Record<string, unknown>][] = [
  ['Bash', { command: 'cd /a/b && sudo env X=1 git -C dir push origin main | tee out.log; find . -name "*.ts" -exec grep -l foo {} +', description: 'Push' }],
  ['Bash', { command: 'git status', description: 'Status' }],
  ['Read', { file_path: '/Users/a/work/src/main.py' }],
  ['Edit', { file_path: '/Users/a/work/src/main.py', old_string: 'a'.repeat(2000), new_string: 'b'.repeat(2000) }],
  ['WebFetch', { url: 'https://user:pw@a.b.example.com:8080/x/y?q=1#z' }],
  ['mcp__memory__search', { query: 'x' }],
  ['TaskCreate', { subject: 's' }],
]

const busy = (): Board => {
  const entries = Array.from({ length: 80 }, (_, i) => ({
    id: `e${i}`,
    station: STATIONS[i % STATIONS.length]?.id ?? 'shell',
    label: `call ${i} with a label of ordinary length`,
    from: i % 7 === 0 ? ('agents' as const) : ('core' as const),
    startedAt: 1_000_000 + i * 400,
    ...(i > 74 ? {} : { endedAt: 1_000_200 + i * 400 }),
    status: i > 74 ? ('run' as const) : i % 13 === 0 ? ('err' as const) : ('ok' as const),
    ...(i % 7 === 0 ? { agentId: `a${i % 3}` } : {}),
  }))
  return { entries, counts: Object.fromEntries(STATIONS.map(x => [x.id, 400])), context: 61, model: 'claude-opus-5-5', step: 4, agents: ['a0', 'a1', 'a2'], faults: { web: 2 }, pushed: 5 }
}

test('principle 3: naming a call, drawing the map and folding the rows each stay within their budget', () => {
  const naming = timed(3000, i => { const [tool, input] = ORDINARY[i % ORDINARY.length] ?? ['Read', {}]; classify(tool, input, PLAIN) })
  const board = busy()
  const drawing = timed(400, i => { drawMap(board, 1_033_000 + i * 16, PLAIN) })
  const folding = timed(3000, () => { foldRows(board.entries) })
  // A script of 20,000 characters written into the command line: the longest thing the mod ever reads.
  const script = `cat > /tmp/f.py <<'EOF'\n${'print("a line of code")\n'.repeat(800)}EOF`
  const long = timed(10, () => { classify('Bash', { command: script }, PLAIN) })
  console.log(`COST naming ${(naming * 1000).toFixed(1)}us | drawing ${(drawing * 1000).toFixed(1)}us | folding ${(folding * 1000).toFixed(1)}us | a ${Math.round(script.length / 1000)}k script ${long.toFixed(1)}ms`)
  expect(naming).toBeLessThan(0.5)
  expect(drawing).toBeLessThan(2)
  expect(folding).toBeLessThan(0.2)
  expect(long).toBeLessThan(150)
})

test('principle 3: a tool call through the mod stays within its budget, and the two hundredth costs what the first did', async ($, on) => {
  let clock = 1_000_000
  on('clock.now', () => ({ value: clock++ }))
  on('tool.call', () => ({ result: {} }))
  const call = async (i: number): Promise<number> => {
    const started = now()
    await $.tool.call({ tool: i % 2 === 0 ? 'Read' : 'Bash', file_path: `/a/b/${i}.py`, command: 'git status', description: 'Status' } as never)
    return now() - started
  }
  const median = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0
  for (let i = 0; i < 50; i++) await call(i)
  const early: number[] = []
  for (let i = 0; i < 100; i++) early.push(await call(i))
  for (let i = 0; i < 200; i++) await call(i)
  const late: number[] = []
  for (let i = 0; i < 100; i++) late.push(await call(i))
  console.log(`COST a tool call through the mod and the test kit: median ${median(early).toFixed(2)}ms, after 300 more ${median(late).toFixed(2)}ms`)
  expect(median(early)).toBeLessThan(15)
  expect(median(late)).toBeLessThan(median(early) * 3 + 1)
})

// ---- 4. A fault on the map never reaches the work ---------------------------------------------------

test('principle 4: with the engine refusing every call the mod makes, each event still goes through', async ($, on) => {
  for (const call of ['state.get', 'state.set', 'store.get', 'store.set', 'clock.now', 'session.usage'] as const) on(call as never, (() => { throw new Error('broken') }) as never)
  on('tool.call', () => ({ result: { ok: true } }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['x'] }))
  on('classic.SessionStart', () => ({ additionalContext: ['x'] }))
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  on('session.compact', () => ({ skip: 'kept' }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: 'kept' }))

  expect((await $.tool.call({ tool: 'Read', file_path: '/a' })).result).toEqual({ ok: true })
  expect(await $.prompt.submit({ text: 'hello' } as never)).toEqual(expect.objectContaining({ text: 'hello' }))
  expect((await $.classic.UserPromptSubmit({ prompt: 'x', permission_mode: 'default' } as never)).additionalContext).toEqual(['x'])
  expect((await $.classic.SessionStart({ source: 'startup' } as never)).additionalContext).toEqual(['x'])
  expect(await $.skill.prompt({ skill: 'pdf', text: 'body' } as never)).toEqual(expect.objectContaining({ text: 'body' }))
  expect(await $.session.compact({ trigger: 'manual', messages: TALK } as never)).toEqual(expect.objectContaining({ skip: 'kept' }))
  expect(await $.turn.start({ text: 'hello', turnId: 't1' } as never)).toEqual(expect.objectContaining({ turnId: 't1' }))
  expect(await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end' } as never)).toEqual(expect.objectContaining({ text: 'kept' }))
})

// ---- 5. A calm map ----------------------------------------------------------------------------------

test('principle 5: ten stations, a label of at most 120 characters, and a drawing that does not grow with the session', () => {
  expect(STATIONS.length).toBe(10)
  expect(clean('x'.repeat(500)).length).toBe(120)
  for (const tool of TOOLS) expect(clean(classify(tool, loaded({ description: 'd'.repeat(500), skill: 's'.repeat(500) }), PLAIN).label).length).toBeLessThanOrEqual(120)

  const session = (calls: number): Board => {
    const entries = Array.from({ length: calls }, (_, i) => {
      const station = STATIONS[i % STATIONS.length]?.id ?? 'shell'
      return { id: `e${i}`, station, label: `call ${i}`, from: 'core' as const, startedAt: 1000 + i * 10, endedAt: 1005 + i * 10, status: 'ok' as const }
    })
    return { entries: entries.slice(-80), counts: Object.fromEntries(STATIONS.map(s => [s.id, calls])) }
  }
  const elements = (svg: string): number => svg.split('<').length - 1
  const far = 10_000_000
  // Past the first eighty calls the drawing has what it will ever have: more work adds to the counts, not to the picture.
  expect(elements(drawMap(session(5000), far, PLAIN))).toBe(elements(drawMap(session(80), far, PLAIN)))
  expect(foldRows(session(5000).entries).length).toBeLessThanOrEqual(80)
})

// ---- 6. It works with nothing set -------------------------------------------------------------------

test('principle 6: every option left unset behaves as its documented default', () => {
  // The defaults as `.claude-plugin/plugin.json` documents them. A test cannot read that file, so `scripts/check-surface.mjs` holds this list to it.
  const defaults = DEFAULTS
  const plain = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (x instanceof Set || x instanceof Map ? [...x] : x))
  // The one default the code does not repeat is the list the manifest fills: the memory server every install may have.
  expect(plain(setupFrom(defaults))).toBe(plain(setupFrom({ memoryServers: ['memory'] })))
})

test('principle 6: with no options set, the engine hands the mod its documented defaults', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'mcp__memory__search', query: 'x' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /search/ }))?.text).toContain('Memory')
  await ui.unmount()
})
