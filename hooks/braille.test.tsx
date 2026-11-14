// The braille map in a terminal: the drawing in cells, and the pane that shows it to a person who asked for it.
import { expect, mock, test } from 'claude-code/testing'

import type { Board, Entry } from '../types'
import { ENDLESS_FOR_MS, FRAME_MS, brailleSize, nextFrameIn, packCells, paintBraille, placesOf, rowsOf } from './braille'
import { STATIONS, setupFrom } from './map'
import { fromBase64 } from './raster'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** The braille map is there only for a person who asked for it. */
const BRAILLE = { terminalView: 'braille' } as const

const NOW = 1_000_000
const EMPTY: Board = { entries: [], counts: {} }

const entry = (station: Entry['station'], startedAt: number, more: Partial<Entry> = {}): Entry => ({
  id: `${station}${startedAt}`,
  station,
  label: station,
  from: 'core',
  startedAt,
  endedAt: startedAt + 10,
  status: 'ok',
  ...more,
})

const running = (station: Entry['station'], startedAt: number): Entry => entry(station, startedAt, { status: 'run', endedAt: undefined })

const isBraille = (letter: string | undefined): boolean => letter !== undefined && letter >= '⠁' && letter <= '⣿'

/** The cells a Raster was given, read back: each one's letter and the color it is written in. */
function unpack(cells: string): { letter: string; ink: number; ground: number }[] {
  const bytes = fromBase64(cells)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: bytes.length / 12 }, (_, i) => ({
    letter: String.fromCodePoint(view.getUint32(i * 12, true)),
    ink: view.getUint32(i * 12 + 4, true),
    ground: view.getUint32(i * 12 + 8, true),
  }))
}

/** The color the first letter of `word` is written in, on a map 60 cells wide. */
function inkOf(cells: string, word: string): number | undefined {
  const all = unpack(cells)
  const at = all.map(x => x.letter).join('').indexOf(word)
  return at < 0 ? undefined : all[at]?.ink
}

test('terminalView takes braille beside text and picture, and anything else counts as not set', () => {
  expect(setupFrom({ terminalView: 'braille' }).terminalView).toBe('braille')
  expect(setupFrom({ terminalView: 'Braille' }).terminalView).toBe('text')
  expect(setupFrom({ terminalView: 'dots' }).terminalView).toBe('text')
  expect(setupFrom({ terminalView: ['braille'] }).terminalView).toBe('text')
})

for (const layout of ['you-top', 'you-bottom'] as const) {
  test(`the braille map draws every station in STATIONS, with layout ${layout}`, () => {
    const setup = setupFrom({ layout })
    for (const [columns, rows] of [[50, 17], [60, 21], [76, 21]] as const) {
      const places = placesOf(setup, columns, rows)
      // One place a station, in the stations' own order, and no two in the same cells.
      expect(places.map(p => p.id)).toEqual(STATIONS.map(s => s.id))
      expect(new Set(places.map(p => `${p.column},${p.row}`)).size).toBe(STATIONS.length)

      const grid = rowsOf(paintBraille(EMPTY, NOW, setup, columns, rows))
      for (const p of places) {
        // The node: a ring of dots, four cells wide and two rows tall, whole on the grid.
        for (const row of [p.row, p.row + 1]) for (let k = 0; k < 4; k++) expect(isBraille(grid[row]?.[p.column + k])).toBe(true)
        // Its name, in the row over or under it, centred on it.
        const name = setup.t.stations[p.id]
        const at = grid[p.nameRow]?.indexOf(name) ?? -1
        expect(at).toBeGreaterThanOrEqual(0)
        expect(Math.abs(at + name.length / 2 - (p.column + 2))).toBeLessThanOrEqual(1)
      }

      // The person is at the top or at the bottom, as the layout says, and the rest follows round.
      const you = places.find(p => p.id === 'you')
      expect(you?.row).toBe(layout === 'you-top' ? 1 : rows - 3)
      const turned = placesOf(setupFrom({ layout: layout === 'you-top' ? 'you-bottom' : 'you-top' }), columns, rows)
      places.forEach((p, i) => expect([p.column, p.row]).toEqual([turned[(i + STATIONS.length / 2) % STATIONS.length]?.column, turned[(i + STATIONS.length / 2) % STATIONS.length]?.row]))
    }
  })

  test(`every station in STATIONS shows on the braille map when it is at work, with layout ${layout}`, () => {
    const setup = setupFrom({ layout })
    const places = placesOf(setup, 60, 21)
    for (const s of STATIONS) {
      const grid = rowsOf(paintBraille({ entries: [running(s.id, NOW - 5000)], counts: { [s.id]: 1 } }, NOW, setup, 60, 21))
      // Only the station at work has a full node; the others are rings.
      for (const p of places) expect(grid[p.row]?.slice(p.column + 1, p.column + 3) === '⣿⣿').toBe(p.id === s.id)
    }
  })
}

test('the braille map shows what the first drawing counts: calls, faults, how many run at once, the context and the model', () => {
  const setup = setupFrom()
  const board: Board = {
    entries: [running('shell', NOW - 300), running('shell', NOW - 200), entry('web', NOW - 2000, { status: 'err' })],
    counts: { shell: 6, files: 9, web: 3 },
    faults: { web: 2 },
    model: 'claude-opus-5-5',
    context: 41,
  }
  const grid = rowsOf(paintBraille(board, NOW, setup, 60, 21)).join('\n')
  expect(grid).toContain('Shell 6 x2')
  expect(grid).toContain('Files 9')
  expect(grid).toContain('Network 3 !2')
  expect(grid).toContain('41%')
  expect(grid).toContain('CLAUDE')
  expect(grid).toContain('opus 5.5')
  // A station not used yet has its name alone.
  expect(grid).toMatch(/Browser(?! \d)/)
})

test('no label reaches the braille map: it holds the names of the stations, the counts, the core and the model, and nothing else', () => {
  const mark = 'SECRETMARK'
  const board: Board = {
    entries: STATIONS.map((s, i) => entry(s.id, NOW - 100 * i, { label: `${mark} ${i}`, id: `${mark}${i}`, agentId: mark, task: mark })),
    counts: Object.fromEntries(STATIONS.map(s => [s.id, 3])),
    agents: [mark],
    model: 'claude-opus-5-5',
    context: 12,
  }
  const cells = paintBraille(board, NOW, setupFrom(), 76, 21)
  expect(rowsOf(cells).join('\n')).not.toContain(mark)
  expect(unpack(packCells(cells)).map(x => x.letter).join('')).not.toContain(mark)
  // Every letter on the grid belongs to a word the map is allowed: take those away, and only dots are left.
  const setup = setupFrom()
  let letters = rowsOf(cells).join(' ')
  for (const word of [...Object.values(setup.t.stations), setup.core, 'opus 5.5', '12%']) letters = letters.split(word).join(' ')
  expect(letters.replace(/[⠀-⣿\s\d]/g, '')).toBe('')
})

test('a core name in letters a cell cannot hold is written with question marks, and the pane keeps its map', { options: { ...BRAILLE, coreName: '日本語' } }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  expect(rowsOf(paintBraille(EMPTY, NOW, setupFrom({ coreName: '日本語' }), 60, 21)).join('\n')).toContain('???')
  // Nor is a letter outside the basic plane, a control character, or a mark that stands on the letter before it.
  expect(rowsOf(paintBraille(EMPTY, NOW, setupFrom({ coreName: 'a😀b\u0007x́' }), 60, 21)).join('\n')).toContain('a?b?x?')
  // Latin with its accents, Greek and Cyrillic are a cell each.
  for (const name of ['ДОМ', 'Señor', 'Ωmega', 'Ação']) expect(rowsOf(paintBraille(EMPTY, NOW, setupFrom({ coreName: name }), 60, 21)).join('\n')).toContain(name)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster' })
  expect(unpack(String(raster?.props.cells)).map(x => x.letter).join('')).toContain('???')
  await ui.unmount()
})

test('with terminalView braille, a terminal with the room draws the map as cells above the rows', { options: BRAILLE }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.key).toBe('map')
  expect(raster?.props.columns).toBe(60)
  expect(raster?.props.rows).toBe(21)
  // Sixteen characters of base64 a cell: three u32, twelve bytes.
  const cells = String(raster?.props.cells)
  expect(cells.length).toBe(60 * 21 * 16)
  const read = unpack(cells)
  expect(read.map(x => x.letter).join('')).toContain('Files 1')
  // On a ground of its own, as the desktop map is: with nothing set, the dark palette's.
  expect(read.every(x => x.ground === 0x0a0c11)).toBe(true)
  // No picture beside it, and the rows are still there under it.
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')
  await ui.unmount()
})

test('a pane too narrow or too short for the braille map keeps the rows alone', { options: BRAILLE }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  for (const props of [{ ...PANE.props, bodyColumns: 49 }, { ...PANE.props, scroll: { offset: 0, bodyRows: 24 } }]) {
    const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')
    await ui.unmount()
  }
  // From 50 columns and 25 rows of body, up to 76 by 21.
  expect(brailleSize(50, 25)).toEqual({ columns: 50, rows: 17 })
  expect(brailleSize(200, 90)).toEqual({ columns: 76, rows: 21 })
  expect(brailleSize(49, 90)).toBeUndefined()
  expect(brailleSize(200, 24)).toBeUndefined()
})

test('the picture never falls back to braille: a terminal that shows no pictures gets the rows alone', { options: { terminalView: 'picture' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.blit', () => ({ value: { deny: 'the Image draws its alt there' } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await clock.advance(100)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('the braille map gets frames only while something on it moves, about eight a second, and none at rest', { options: BRAILLE, timeoutMs: 15_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const frames: { requestId: string; key: string; columns?: number; rows?: number }[] = []
  on('ui.blit', (_, e) => {
    frames.push(e as (typeof frames)[number])
    return { value: {} }
  })
  on('tool.call', () => ({ result: {} }))

  // Nothing has happened yet: the map is drawn once and stands.
  const rest = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(5000)
  expect(frames.length).toBe(0)
  await rest.unmount()

  await $.tool.call({ tool: 'Read', file_path: '/a/b/c.py' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The pulse flies out and back for 0.8 s.
  await clock.advance(1000)
  expect(frames.length).toBeGreaterThanOrEqual(6)
  expect(frames.length).toBeLessThanOrEqual(8)
  expect(frames[0]).toMatchObject({ requestId: 'lot-map', key: 'map', columns: 60, rows: 21 })
  // Then two frames more, each at its moment: the spoke goes out (1.6 s), the station's glow goes out (3.2 s).
  const flown = frames.length
  await clock.advance(3000)
  expect(frames.length).toBe(flown + 2)
  // And the map is at rest.
  await clock.advance(60_000)
  expect(frames.length).toBe(flown + 2)
  await ui.unmount()
})

test('a braille map the pane no longer shows gets no more frames until it is drawn again', { options: BRAILLE }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let frames = 0
  on('ui.blit', () => {
    frames++
    return { value: { deny: 'not mounted' } }
  })
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/c.py' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(2000)
  expect(frames).toBe(1)
  await ui.unmount()
})

test('the braille map asks for its next frame when it will next look different, and for none at rest', () => {
  const setup = setupFrom()
  const reduced = setupFrom({ motion: 'reduced' })
  const board = (entries: Entry[], more: Partial<Board> = {}): Board => ({ entries, counts: {}, ...more })

  expect(nextFrameIn(EMPTY, NOW, setup)).toBeUndefined()
  // A call just made: its pulse flies.
  expect(nextFrameIn(board([entry('files', NOW - 100)]), NOW, setup)).toBe(FRAME_MS)
  // Landed: nothing moves until the spoke goes out, 1.6 s after the call began, and then the glow, 3.2 s after it ended.
  expect(nextFrameIn(board([entry('files', NOW - 1000)]), NOW, setup)).toBe(600)
  expect(nextFrameIn(board([entry('files', NOW - 2000)]), NOW, setup)).toBe(1210)
  expect(nextFrameIn(board([entry('files', NOW - 4000)]), NOW, setup)).toBeUndefined()
  // A fault stays red for six seconds.
  expect(nextFrameIn(board([entry('web', NOW - 4000, { status: 'err' })]), NOW, setup)).toBe(2010)
  // The answer's ring, and the model's name bright for eight seconds after a change.
  expect(nextFrameIn(board([entry('you', NOW - 500, { mark: 'done' })]), NOW, setup)).toBe(FRAME_MS)
  expect(nextFrameIn(board([], { switchedAt: NOW - 3000 }), NOW, setup)).toBe(5000)

  // A call that runs on beats: a frame at each turn of the beat, 400 ms apart.
  const long = board([running('shell', NOW - 60_000)])
  expect(nextFrameIn(long, NOW, setup)).toBe(400)
  expect(nextFrameIn(long, NOW + 150, setup)).toBe(250)
  // Subagents circle: a frame each time.
  expect(nextFrameIn(board([], { agents: ['a1'] }), NOW, setup)).toBe(FRAME_MS)
  // Ten minutes after the board last changed, what still runs gets a frame every five seconds.
  expect(nextFrameIn(long, NOW, setup, ENDLESS_FOR_MS)).toBe(5000)
  expect(nextFrameIn(board([], { agents: ['a1'] }), NOW, setup, ENDLESS_FOR_MS)).toBe(5000)

  // With reduced motion nothing flies, beats or circles: only the moments a color changes are left.
  expect(nextFrameIn(board([entry('files', NOW - 100)]), NOW, reduced)).toBe(1500)
  expect(nextFrameIn(long, NOW, reduced)).toBeUndefined()
  expect(nextFrameIn(board([], { agents: ['a1'] }), NOW, reduced)).toBeUndefined()
})

test('with motion reduced the braille map has no pulse, no beat and no circling: a call lights its station and its spoke', () => {
  const board: Board = { entries: [running('shell', NOW - 60_000), entry('files', NOW - 100)], counts: { shell: 1, files: 1 }, agents: ['a1', 'a2'] }
  const at = (now: number, options: Record<string, unknown>): string => packCells(paintBraille(board, now, setupFrom(options), 60, 21))
  // Full motion: the pulse, the beat and the subagents make each moment its own picture.
  expect(at(NOW, {})).not.toBe(at(NOW + 200, {}))
  // Reduced: the same picture until a color changes.
  expect(at(NOW, { motion: 'reduced' })).toBe(at(NOW + 200, { motion: 'reduced' }))
  expect(at(NOW, { motion: 'reduced' })).toBe(at(NOW + 1400, { motion: 'reduced' }))
  // The spoke of the call just made goes out 1.6 s after it began; the station stays lit a while longer.
  expect(at(NOW, { motion: 'reduced' })).not.toBe(at(NOW + 1600, { motion: 'reduced' }))
  // The subagents stand at their places on the circle, and the station at work is full.
  const still = rowsOf(paintBraille(board, NOW, setupFrom({ motion: 'reduced' }), 60, 21))
  const shell = placesOf(setupFrom(), 60, 21).find(p => p.id === 'shell')
  expect(still[shell?.row ?? 0]?.slice((shell?.column ?? 0) + 1, (shell?.column ?? 0) + 3)).toBe('⣿⣿')
})

/** A map with one station used, as a Raster would get it, and the grounds its cells stand on: one, whatever the cell holds. */
const used = (options: Record<string, unknown>): string => packCells(paintBraille({ entries: [], counts: { files: 3 } }, NOW, setupFrom(options), 60, 21))
const groundsOf = (options: Record<string, unknown>): number[] => [...new Set(unpack(used(options)).map(x => x.ground))]

test('with background solid, as it is unless changed, the braille map stands on the palette\'s ground with the palette\'s words, so it reads in any pane', () => {
  // The pane's ground is Claude Code's theme's and the terminal's own colors are the terminal's: the map leans on neither.
  expect(groundsOf({})).toEqual([0x0a0c11])
  expect(inkOf(used({}), 'CLAUDE')).toBe(0xebe6dc)
  expect(groundsOf({ theme: 'light' })).toEqual([0xf5f2ea])
  expect(inkOf(used({ theme: 'light' }), 'CLAUDE')).toBe(0x1f2228)
  // The person's own colors hold.
  expect(groundsOf({ colors: 'background=#123456' })).toEqual([0x123456])
  expect(inkOf(used({ colors: 'text=#112233' }), 'CLAUDE')).toBe(0x112233)
  // The name of a station that was used: the palette's label color, dark or light, or the person's.
  expect(inkOf(used({ theme: 'dark' }), 'Files 3')).toBe(0x9ba1ab)
  expect(inkOf(used({ theme: 'light' }), 'Files 3')).toBe(0x5f6570)
  expect(inkOf(used({ colors: 'label=#445566' }), 'Files 3')).toBe(0x445566)
})

test('with background transparent the braille map has no ground, and its words take the terminal\'s own color', () => {
  const bare = { background: 'transparent' }
  expect(groundsOf(bare)).toEqual([0x01000000])
  expect(inkOf(used(bare), 'CLAUDE')).toBe(0x01000000)
  expect(groundsOf({ ...bare, theme: 'light' })).toEqual([0x01000000])
  expect(inkOf(used({ ...bare, theme: 'light' }), 'CLAUDE')).toBe(0x01000000)
  // A background color of the person's own does not bring the ground back; a text color of theirs still holds.
  expect(groundsOf({ ...bare, colors: 'background=#123456' })).toEqual([0x01000000])
  expect(inkOf(used({ ...bare, colors: 'text=#112233' }), 'CLAUDE')).toBe(0x112233)
  // The rest is the palette's, as on a ground.
  expect(inkOf(used({ ...bare, theme: 'dark' }), 'Files 3')).toBe(0x9ba1ab)
  expect(inkOf(used({ ...bare, theme: 'light' }), 'Files 3')).toBe(0x5f6570)
})

for (const [what, variables, label, ground] of [
  ['a light terminal gets the light colors on their light ground', { COLORFGBG: '0;15' }, 0x5f6570, 0xf5f2ea],
  ['a dark terminal gets the dark colors on their dark ground', { COLORFGBG: '15;0' }, 0x9ba1ab, 0x0a0c11],
  ['a terminal that says nothing gets the dark colors on their dark ground', {}, 0x9ba1ab, 0x0a0c11],
] as const) {
  test(`with theme auto, ${what} on the braille map`, { options: BRAILLE }, async ($, on) => {
    let clock = NOW
    on('clock.now', () => ({ value: clock }))
    mock.env(on, variables)
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a/b/c.py' })
    // Long after the call, so that the station is no longer lit and its name is in the label color.
    clock = NOW + 60_000
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const cells = String((await ui.find({ type: 'Raster' }))?.props.cells)
    expect(inkOf(cells, 'Files 1')).toBe(label)
    expect(unpack(cells).every(x => x.ground === ground)).toBe(true)
    await ui.unmount()
  })
}

// ---- what a frame costs ----------------------------------------------------------------------------

// As in principles.test.tsx: the budget is many times what was measured, so that a slow runner passes and only a
// change of kind fails.
const timed = (times: number, work: (i: number) => void): number => {
  for (let i = 0; i < Math.min(200, times); i++) work(i)
  const started = performance.now()
  for (let i = 0; i < times; i++) work(i)
  return (performance.now() - started) / times
}

test('principle 3: a frame of the braille map, painted and packed, stays within its budget', () => {
  const entries = Array.from({ length: 80 }, (_, i) => ({
    id: `e${i}`,
    station: STATIONS[i % STATIONS.length]?.id ?? 'shell',
    label: `call ${i} with a label of ordinary length`,
    from: i % 7 === 0 ? ('agents' as const) : ('core' as const),
    startedAt: NOW + i * 400,
    ...(i > 74 ? {} : { endedAt: NOW + 200 + i * 400 }),
    status: i > 74 ? ('run' as const) : i % 13 === 0 ? ('err' as const) : ('ok' as const),
  }))
  const board: Board = { entries, counts: Object.fromEntries(STATIONS.map(x => [x.id, 400])), context: 61, model: 'claude-opus-5-5', step: 4, agents: ['a0', 'a1', 'a2'], faults: { web: 2 } }
  const setup = setupFrom()
  // The largest map there is, at moments a frame apart, with five calls running and three subagents.
  const painting = timed(400, i => { paintBraille(board, NOW + 33_000 + i * FRAME_MS, setup, 76, 21) })
  const whole = timed(400, i => { packCells(paintBraille(board, NOW + 33_000 + i * FRAME_MS, setup, 76, 21)) })
  const asking = timed(400, i => { nextFrameIn(board, NOW + 33_000 + i * FRAME_MS, setup) })
  console.log(`COST a braille frame of 76 by 21: painting ${(painting * 1000).toFixed(0)}us | painted and packed ${(whole * 1000).toFixed(0)}us | asking when the next is due ${(asking * 1000).toFixed(1)}us`)
  expect(whole).toBeLessThan(5)
  expect(asking).toBeLessThan(0.5)
})
