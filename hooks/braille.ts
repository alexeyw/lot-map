// The braille map (`terminalView: braille`): the board drawn a second time, as cells for a terminal that shows no
// pictures. Braille dots make the spokes, the nodes and the core; letters make the names. It takes the stations from
// `STATIONS`, the colors from the palette, the words from the language's table and the timings from the first
// drawing, and names none of them itself. What it leaves out of the first drawing is listed in the README.
// Nothing here touches the engine.
import type { Board, Entry, StationId } from '../types'
import { shortModel } from './classify'
import { ALARM_MS, DONE_MS, GLOW_MS, PULSE_MS, SWITCH_MS } from './draw'
import { DARK, LIGHT } from './palette'
import type { Palette } from './palette'
import { STATIONS } from './setup'
import type { Setup } from './setup'

// ---- the room it takes ---------------------------------------------------------------------------

const MIN_COLUMNS = 50
const MAX_COLUMNS = 76
const MIN_ROWS = 17
const MAX_ROWS = 21
/** Rows left under the map for the line of now, the counts and the first rows of the feed. */
const FEED_ROWS = 8

/** The cells the map takes in a pane's body, or nothing where the body is too small to read it in. */
export function brailleSize(bodyColumns: number, bodyRows: number): { columns: number; rows: number } | undefined {
  const columns = Math.min(MAX_COLUMNS, Math.floor(bodyColumns))
  const rows = Math.min(MAX_ROWS, Math.floor(bodyRows) - FEED_ROWS)
  return columns >= MIN_COLUMNS && rows >= MIN_ROWS ? { columns, rows } : undefined
}

// ---- cells ---------------------------------------------------------------------------------------

/** The terminal's own color, as a Raster takes it. */
const DEFAULT = 0x01000000
const SPACE = 0x20
const BRAILLE = 0x2800
/** The bit of each dot of a braille cell, by row then column. */
const DOTS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]

/**
 * A grid of cells. Each holds a letter or a set of braille dots, in one color: a dot is half a cell wide and a quarter
 * tall. All of them stand on one ground.
 */
export type Cells = { columns: number; rows: number; glyph: Uint32Array; ink: Uint32Array; dots: Uint8Array; ground: number }

function blank(columns: number, rows: number, ground: number): Cells {
  const n = columns * rows
  return { columns, rows, glyph: new Uint32Array(n).fill(SPACE), ink: new Uint32Array(n).fill(DEFAULT), dots: new Uint8Array(n), ground }
}

function dot(c: Cells, x: number, y: number, color: number): void {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= c.columns * 2 || py >= c.rows * 4) return
  const i = (py >> 2) * c.columns + (px >> 1)
  c.dots[i] = (c.dots[i] ?? 0) | (DOTS[(py & 3) * 2 + (px & 1)] ?? 0)
  c.ink[i] = color
}

function line(c: Cells, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  for (let k = 0; k <= steps; k++) dot(c, x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, color)
}

/** An ellipse's outline. `color` is asked for each point by how far round it is from the top, clockwise, 0 to 1. */
function oval(c: Cells, cx: number, cy: number, rx: number, ry: number, color: (round: number) => number, every = 1): void {
  const steps = Math.ceil(2 * Math.PI * Math.max(rx, ry) * 1.5)
  for (let k = 0; k < steps; k += every) {
    const a = (k / steps) * 2 * Math.PI
    dot(c, cx + rx * Math.sin(a), cy - ry * Math.cos(a), color(k / steps))
  }
}

/**
 * Whether a cell can hold the letter. A Raster takes one printable character a column wide and refuses the whole
 * drawing for any other, so only scripts known to be that are let through: Latin, Greek and Cyrillic.
 */
const fits = (code: number): boolean =>
  (code >= 0x20 && code < 0x7f) || (code >= 0xa1 && code < 0x250 && code !== 0xad) || (code >= 0x370 && code < 0x530 && /^[\p{L}\p{N}\p{P}]$/u.test(String.fromCodePoint(code)))

/** Letters over whatever dots were there: a name is never struck through by a line. One the grid cannot hold is a `?`. */
function write(c: Cells, column: number, row: number, text: string, color: number): void {
  if (row < 0 || row >= c.rows) return
  let at = column
  for (const letter of text.normalize('NFC')) {
    if (at >= 0 && at < c.columns) {
      const code = letter.codePointAt(0) ?? SPACE
      const i = row * c.columns + at
      c.glyph[i] = fits(code) ? code : 0x3f
      c.dots[i] = 0
      c.ink[i] = color
    }
    at++
  }
}

const codeAt = (c: Cells, i: number): number => ((c.dots[i] ?? 0) !== 0 ? BRAILLE + (c.dots[i] ?? 0) : (c.glyph[i] ?? SPACE))

/** The cells as a Raster takes them: base64 of little-endian u32 triplets, code point, foreground, background. */
export function packCells(c: Cells): string {
  const n = c.columns * c.rows
  const bytes = new Uint8Array(n * 12)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < n; i++) {
    view.setUint32(i * 12, codeAt(c, i), true)
    view.setUint32(i * 12 + 4, c.ink[i] ?? DEFAULT, true)
    view.setUint32(i * 12 + 8, c.ground, true)
  }
  // The runtime's own encoder where it has one: a frame goes out eight times a second, and `btoa` takes forty times as long.
  const encode = (bytes as { toBase64?: () => string }).toBase64
  if (typeof encode === 'function') return encode.call(bytes)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** The rows as plain text, colors left out: what a test reads. */
export function rowsOf(c: Cells): string[] {
  const rows: string[] = []
  for (let r = 0; r < c.rows; r++) {
    let text = ''
    for (let k = 0; k < c.columns; k++) text += String.fromCodePoint(codeAt(c, r * c.columns + k))
    rows.push(text.replace(/\s+$/, ''))
  }
  return rows
}

// ---- colors --------------------------------------------------------------------------------------

type Ink = { ground: number; text: number; label: number; faint: number; line: number; accent: number; hot: number; red: number; mem: number; memHot: number }

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

function mix(a: number, b: number, t: number): number {
  if (a === DEFAULT || b === DEFAULT) return t < 0.5 ? a : b
  const part = (shift: number): number => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t)
  return (part(16) << 16) | (part(8) << 8) | part(0)
}

/**
 * The palette's colors, as the first drawing has them, and `background` meaning what it means there.
 *
 * `solid`: the cells stand on the palette's ground and the words take its text color, so the map reads in any pane.
 * The pane's ground comes from Claude Code's theme and a cell cannot ask for it, so where that theme and the palette
 * differ this is a light map in a dark pane, or the other way round, as the picture is.
 *
 * `transparent`: no ground, and the words in the terminal's own color unless the person set one. That reads only
 * where the terminal and Claude Code's theme agree: a light terminal's dark words cannot be read on a dark pane.
 *
 * Either way a line at rest is halfway between `line` and `faint`: a row of single dots is much fainter than the same
 * color in a stroke.
 */
function inkOf(setup: Setup): Ink {
  const p: Palette = { ...(setup.theme === 'light' ? LIGHT : DARK), ...setup.colors }
  const isBare = setup.background === 'transparent'
  return {
    ground: isBare ? DEFAULT : rgb(p.ground),
    text: isBare && setup.colors.bone === undefined ? DEFAULT : rgb(p.bone),
    label: rgb(p.ash),
    faint: rgb(p.dim),
    line: setup.colors.line === undefined ? mix(rgb(p.line), rgb(p.dim), 0.5) : rgb(p.line),
    accent: rgb(p.accent),
    hot: rgb(p.hot),
    red: rgb(p.red),
    mem: rgb(p.mem),
    memHot: rgb(p.memHot),
  }
}

// ---- the ring ------------------------------------------------------------------------------------

/** As the first drawing: the newest entries are the ones that can still show. */
const RECENT = 40
/** A spoke stays lit this long after a call starts on it, as the first drawing's beam does. */
const BEAM_MS = GLOW_MS / 2
/** A station at work wears a second ring every other beat. */
const BEAT_MS = 400
/** A lap of a subagent around the agents station, as in the first drawing. */
const LAP_MS = 7000
/** The core's half-width and half-height in dots: room for three rows of words. */
const CORE_RX = 18
const CORE_RY = 9

/** A node is eight dots by eight, four cells wide and two rows tall: a ring with its middle empty, marked or full. */
const NODE = ['..XXXX..', '.X....X.', 'X......X', 'X......X', 'X......X', 'X......X', '.X....X.', '..XXXX..']
const NODE_USED = ['..XXXX..', '.X....X.', 'X......X', 'X..XX..X', 'X..XX..X', 'X......X', '.X....X.', '..XXXX..']
const NODE_FULL = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..']

function node(c: Cells, x: number, y: number, shape: readonly string[], color: number): void {
  shape.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] === 'X') dot(c, x - 4 + dx, y - 4 + dy, color)
  })
}

type Point = { x: number; y: number }
type Place = {
  id: StationId
  /** The node's middle, in dots, on the join of four cells. */
  x: number
  y: number
  /** In the upper half the name stands over the node, in the lower half under it, so that no spoke runs through a name. */
  isUpper: boolean
  hasSpoke: boolean
  /** A point of the spoke, 0 at the core and 1 at the node. */
  along: (f: number) => Point
  /** One dot sideways from the spoke. */
  side: Point
}

/** Where everything stands on a grid of this size: the core's middle, and a place for each station of `STATIONS`, in their order. */
function ringOf(setup: Setup, columns: number, rows: number): { cx: number; cy: number; mid: number; places: Place[] } {
  const n = STATIONS.length
  const W = columns * 2
  const H = rows * 4
  const mid = Math.floor(rows / 2)
  // The middle sits on the join of two cells and in the middle of a row, so the three rows of words are centred in the core.
  const cx = 2 * Math.round(columns / 2)
  const cy = mid * 4 + 2
  // A name is centred on its node: the ring leaves half the longest name at each side, and a row at top and bottom.
  const longest = Math.max(...STATIONS.map(s => setup.t.stations[s.id].length)) + 4
  const ry = Math.min(cy, H - cy) - 8
  const rx = Math.max(CORE_RX + 12, Math.min(W / 2 - longest - 1, Math.round(ry * 1.6)))
  // How many places the ring is turned, as in the first drawing: the stations keep their order.
  const shift = setup.layout === 'you-bottom' ? n / 2 : 0
  const places = STATIONS.map((s, i): Place => {
    const a = ((i + shift) * 2 * Math.PI) / n
    // Snapped to whole cells, so every node is the same clean shape.
    const x = 2 * Math.round((cx + rx * Math.sin(a)) / 2)
    const y = 4 * Math.round((cy - ry * Math.cos(a)) / 4)
    const dx = x - cx
    const dy = y - cy
    const length = Math.hypot(dx, dy) || 1
    // A spoke runs from just outside the core to just outside the node.
    const from = 1 / Math.sqrt((dx / (CORE_RX + 3)) ** 2 + (dy / (CORE_RY + 3)) ** 2)
    const to = 1 - 6 / length
    const along = (f: number): Point => ({ x: cx + dx * (from + (to - from) * f), y: cy + dy * (from + (to - from) * f) })
    return { id: s.id, x, y, isUpper: Math.cos(a) > 0, hasSpoke: to > from, along, side: { x: -dy / length, y: dx / length } }
  })
  return { cx, cy, mid, places }
}

/** The cells each station's node and name take on a grid of this size: the node's left column and upper row, and the name's row. */
export function placesOf(setup: Setup, columns: number, rows: number): { id: StationId; column: number; row: number; nameRow: number }[] {
  return ringOf(setup, columns, rows).places.map(p => ({ id: p.id, column: p.x / 2 - 2, row: p.y / 4 - 1, nameRow: p.isUpper ? p.y / 4 - 2 : p.y / 4 + 1 }))
}

// ---- the map -------------------------------------------------------------------------------------

const isBad = (e: Entry): boolean => e.status === 'block' || e.status === 'err'

/** The map at `now`, on `columns` by `rows` cells: the stations in a ring around the core, a spoke to each, pulses on the spokes. */
export function paintBraille(board: Board, now: number, setup: Setup, columns: number, rows: number): Cells {
  const ink = inkOf(setup)
  const c = blank(columns, rows, ink.ground)
  const names = setup.t.stations
  // With reduced motion nothing flies, spreads or circles: a call lights its station and its spoke, and those only change color.
  const isStill = setup.motion === 'reduced'
  const recent = board.entries.slice(-RECENT)
  const { cx, cy, mid, places } = ringOf(setup, columns, rows)
  const placeOf = (id: StationId): Place | undefined => places.find(p => p.id === id)

  // The answer leaves the core as one widening ring.
  const done = recent.filter(e => e.mark === 'done').pop()
  if (!isStill && done !== undefined && now - done.startedAt < DONE_MS) {
    const t = (now - done.startedAt) / DONE_MS
    oval(c, cx, cy, CORE_RX + 3 + t * 16, CORE_RY + 3 + t * 9, () => mix(ink.label, ink.line, t), 2)
  }

  const states = places.map(p => {
    const count = board.counts[p.id] ?? 0
    const own = recent.filter(e => e.station === p.id)
    const running = own.filter(e => e.status === 'run').length
    const latest = own[own.length - 1]
    const since = latest === undefined ? Infinity : now - (latest.endedAt ?? latest.startedAt)
    const alarm = own.filter(isBad).pop()
    const isAlarm = alarm !== undefined && now - (alarm.endedAt ?? alarm.startedAt) < ALARM_MS
    const isLit = running > 0 || since < GLOW_MS
    const isBeamed = running > 0 || own.some(e => now - e.startedAt < BEAM_MS)
    const [main, hot] = p.id === 'memory' ? [ink.mem, ink.memHot] : [ink.accent, ink.hot]
    // A spoke wears in with use: by the end of a session the map shows where the work went.
    const worn = Math.min(1, Math.log2(1 + count) / 7)
    return { count, running, isAlarm, isLit, isBeamed, main, hot, worn }
  })

  // Spokes first, then what flies along them, then the nodes, and the words on top.
  places.forEach((p, i) => {
    const st = states[i]
    if (st === undefined || !p.hasSpoke) return
    const color = st.isAlarm ? ink.red : st.isBeamed ? st.hot : st.count > 0 ? mix(ink.line, st.main, 0.3 + 0.7 * st.worn) : ink.line
    const a = p.along(0)
    const b = p.along(1)
    line(c, a.x, a.y, b.x, b.y, color)
    if (st.worn > 0.45) line(c, a.x + p.side.x, a.y + p.side.y, b.x + p.side.x, b.y + p.side.y, color)
  })

  /** A pulse: a short bright stroke on the spoke, its head `f` of the way along and a tail behind it. */
  const pulse = (p: Place, f: number, isOutward: boolean, color: number): void => {
    if (!p.hasSpoke) return
    for (let k = 0; k < 5; k++) {
      const at = isOutward ? f - k * 0.045 : f + k * 0.045
      if (at < 0 || at > 1) continue
      const q = p.along(at)
      dot(c, q.x, q.y, color)
      if (k < 2) {
        dot(c, q.x + p.side.x, q.y + p.side.y, color)
        dot(c, q.x - p.side.x, q.y - p.side.y, color)
      }
    }
  }
  if (!isStill) {
    for (const e of recent.filter(x => x.endedAt !== undefined && x.from !== 'inbound' && now - x.endedAt < PULSE_MS).slice(-14)) {
      const p = placeOf(e.station)
      if (p !== undefined) pulse(p, 1 - (now - (e.endedAt ?? now)) / PULSE_MS, false, e.status === 'ok' ? ink.label : ink.red)
    }
    for (const e of recent.filter(x => now - x.startedAt < PULSE_MS).slice(-14)) {
      const p = placeOf(e.station)
      if (p === undefined) continue
      const f = (now - e.startedAt) / PULSE_MS
      const color = e.status === 'block' ? ink.red : e.station === 'memory' ? ink.memHot : ink.hot
      // A signal nobody asked for comes in from its station; everything else goes out from the core.
      if (e.from === 'inbound') pulse(p, 1 - f, false, color)
      else pulse(p, f, true, color)
    }
  }

  // The context window is the core's own outline: it fills clockwise from the top as the session goes.
  const full = board.context === undefined ? undefined : Math.max(0, Math.min(100, Math.round(board.context)))
  const fullColor = full === undefined ? ink.line : full >= 90 ? ink.red : full >= 70 ? ink.accent : ink.label
  const rest = recent.some(e => e.status === 'run') ? mix(ink.line, ink.accent, 0.6) : ink.line
  oval(c, cx, cy, CORE_RX, CORE_RY, round => (full !== undefined && round * 100 < full ? fullColor : rest))

  places.forEach((p, i) => {
    const st = states[i]
    if (st === undefined) return
    const color = st.isAlarm ? ink.red : st.isLit ? st.hot : st.count > 0 ? mix(ink.line, st.main, 0.75) : ink.line
    node(c, p.x, p.y, st.running > 0 ? NODE_FULL : st.count > 0 ? NODE_USED : NODE, color)
    // A node at work beats: every other moment it wears a second ring.
    if (!isStill && st.running > 0 && Math.floor(now / BEAT_MS) % 2 === 0) oval(c, p.x - 0.5, p.y - 0.5, 6, 6, () => color, 2)
  })

  // Each subagent still at work circles the agents station. Standing still, each keeps its own place, on the half of
  // the circle away from the station's name, which would hide it.
  const agents = placeOf('agents')
  const crew = (board.agents ?? []).slice(0, 6)
  if (agents !== undefined) {
    crew.forEach((_, k) => {
      const turns = isStill ? (agents.isUpper ? 0.25 : 0.75) + (k + 0.5) / crew.length / 2 : (now % LAP_MS) / LAP_MS + k / crew.length
      const a = turns * 2 * Math.PI
      for (const lead of [0, 0.16]) dot(c, agents.x - 0.5 + 7 * Math.sin(a + lead), agents.y - 0.5 - 7 * Math.cos(a + lead), ink.hot)
    })
  }

  // The words last, over the dots.
  const centred = (text: string, row: number, color: number): void => write(c, Math.round(cx / 2 - text.length / 2), row, text, color)
  if (full !== undefined) centred(`${full}%`, mid - 1, full >= 70 ? fullColor : ink.faint)
  centred(setup.core, mid, ink.text)
  if (board.model !== undefined) {
    const switched = board.switchedAt === undefined ? Infinity : now - board.switchedAt
    centred(shortModel(board.model).slice(0, 14), mid + 1, switched >= 0 && switched < SWITCH_MS ? ink.hot : ink.label)
  }

  places.forEach((p, i) => {
    const st = states[i]
    if (st === undefined) return
    const faults = board.faults?.[p.id] ?? 0
    const name = `${names[p.id]}${st.count > 0 ? ` ${st.count}` : ''}`
    // Beside the name: how many run at once, and what went wrong since the last message.
    const many = st.running > 1 ? ` x${st.running}` : ''
    const wrong = faults > 0 ? ` !${faults > 99 ? '99+' : faults}` : ''
    const width = name.length + many.length + wrong.length
    const row = p.isUpper ? p.y / 4 - 2 : p.y / 4 + 1
    const column = Math.max(0, Math.min(columns - width, Math.round(p.x / 2 - width / 2)))
    write(c, column, row, name, st.isAlarm ? ink.red : st.isLit ? ink.text : st.count > 0 ? ink.label : ink.faint)
    write(c, column + name.length, row, many, st.hot)
    write(c, column + name.length + many.length, row, wrong, ink.red)
  })

  return c
}

// ---- when it next looks different ------------------------------------------------------------------

/** The quickest the map is painted again: eight frames a second, about a dot of a pulse's flight a frame. */
export const FRAME_MS = 125
/** As the picture: what never ends by itself moves freely this long after the map last changed, then gets a frame every five seconds. */
export const ENDLESS_FOR_MS = 600_000
const ENDLESS_LATER_MS = 5000

/**
 * How long until the map next looks different, in ms, or undefined if it will not until the board changes: a map at
 * rest asks for no frame. `sinceDrawn` is how long ago the board last changed.
 */
export function nextFrameIn(board: Board, now: number, setup: Setup, sinceDrawn = 0): number | undefined {
  const recent = board.entries.slice(-RECENT)
  const isStill = setup.motion === 'reduced'
  let soonest = Infinity
  /** A moment at which something changes color. One already past changes nothing more. */
  const until = (moment: number): void => {
    if (moment > now) soonest = Math.min(soonest, moment - now)
  }
  for (const e of recent) {
    const last = e.endedAt ?? e.startedAt
    until(e.startedAt + BEAM_MS)
    until(last + GLOW_MS)
    if (isBad(e)) until(last + ALARM_MS)
    if (isStill) continue
    // What flies: a pulse out or in, a pulse back, the ring of an answer.
    const isFlying = now - e.startedAt < PULSE_MS || (e.endedAt !== undefined && e.from !== 'inbound' && now - e.endedAt < PULSE_MS) || (e.mark === 'done' && now - e.startedAt < DONE_MS)
    if (isFlying) soonest = Math.min(soonest, FRAME_MS)
  }
  if (board.switchedAt !== undefined) until(board.switchedAt + SWITCH_MS)
  if (!isStill) {
    // What never ends by itself: the subagents circling, and the beat of a station at work, which changes only at its turn.
    const isCircled = (board.agents ?? []).length > 0
    const isBeating = recent.some(e => e.status === 'run')
    if (isCircled || isBeating) soonest = Math.min(soonest, sinceDrawn >= ENDLESS_FOR_MS ? ENDLESS_LATER_MS : isCircled ? FRAME_MS : BEAT_MS - (now % BEAT_MS))
  }
  return soonest === Infinity ? undefined : Math.max(FRAME_MS, soonest)
}
