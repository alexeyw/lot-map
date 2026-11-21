// What the map is made of and what the person set: the stations, and the mod's options made ready to use.
// Nothing here touches the engine.
import type { StationId } from '../types'
import { clean } from './classify'
import { COLOR_NAMES } from './palette'
import type { Palette } from './palette'
import { stringsFor } from './text'
import type { Strings } from './text'

// ---- stations ---------------------------------------------------------------------------------

export const STATIONS: { id: StationId; icon: string }[] = [
  { id: 'you', icon: `${ring(0, -3.6, 3.4)}M-6.5 8c0-4 3-6.2 6.5-6.2s6.5 2.2 6.5 6.2` },
  { id: 'model', icon: 'M-5 -5h10v10h-10zM-2 -8.5v3.5M2 -8.5v3.5M-2 5v3.5M2 5v3.5M-8.5 -2h3.5M-8.5 2h3.5M5 -2h3.5M5 2h3.5' },
  { id: 'memory', icon: `M-5 4.5L0 -5L6 3.5M-5 4.5L6 3.5${ring(-5, 4.5, 2.1)}${ring(0, -5, 2.1)}${ring(6, 3.5, 2.1)}` },
  { id: 'files', icon: 'M-5.5 -8h7.5l3.5 3.5v12.5h-11zM2 -8v3.5h3.5' },
  { id: 'shell', icon: 'M-7.5 -5l5 5l-5 5M0 6h7.5' },
  { id: 'web', icon: `${ring(0, 0, 7.8)}M-7.8 0h15.6M0 -7.8c-4.2 4.2 -4.2 11.4 0 15.6M0 -7.8c4.2 4.2 4.2 11.4 0 15.6` },
  { id: 'browser', icon: 'M-8.5 -6.5h17v13h-17zM-8.5 -2.8h17M-6.3 -4.7h.1M-3.8 -4.7h.1' },
  { id: 'agents', icon: `M0 -4v3.5M0 -.5L-6 4M0 -.5L6 4${ring(0, -6, 2.1)}${ring(-6.5, 5.5, 2.1)}${ring(6.5, 5.5, 2.1)}` },
  { id: 'skills', icon: 'M1.5 -8.5L-5.5 1h4.5l-1.5 7.5l7.5 -9.8h-4.5z' },
  { id: 'hooks', icon: `M2.5 -5.5v8a4.2 4.2 0 1 1 -8.4 0v-1.5${ring(2.5, -7.3, 1.8)}` },
]

function ring(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

// ---- what the person set -----------------------------------------------------------------------

/** The mod's options made ready to use. Whatever is missing or malformed counts as not set. */
export type Setup = {
  t: Strings
  core: string
  memoryServers: ReadonlySet<string>
  memoryCommands: readonly string[]
  /** The words after a memory command that may be shown. Any other word could be content. */
  memorySubcommands: ReadonlySet<string>
  memoryPaths: readonly string[]
  memoryLabels: ReadonlyMap<string, string>
  /** MCP servers the person put on a station of their own choosing, by the server's name. Memory keeps `memoryServers`. */
  serverStations: ReadonlyMap<string, StationId>
  /** Shell commands the person put on a station of their own choosing, by the command's name. Memory keeps `memoryCommands`. */
  commandStations: ReadonlyMap<string, StationId>
  hookRecords: boolean
  /** Whether the first line of a hook's refusal is shown. Off, the row names only the tool. */
  hookReasons: boolean
  /** Whether the mod listens to the five events an organisation's guard keeps a mod away from. Off, it adds no hook on them. */
  guardedHooks: boolean
  /** Whether the pane opens by itself when a session starts and when a surface joins. Off, it opens on `/lot-map` alone; the board is kept all the same. */
  openAtStart: boolean
  /** Whether a subagent's model step says which subagent it is, by the description it was started with. Off, it says only that it is one. */
  subagentNames: boolean
  /** Whether a row says about how much its call added to the context, and the desktop map each station's sum. */
  contextCost: boolean
  /** What the ring and its percentage measure the context against: the model's whole window, or the auto-compact window where it is smaller. */
  contextWindow: 'model' | 'compaction'
  theme: 'auto' | 'dark' | 'light'
  /** Whether the map paints its own ground, or leaves the surface it lies on showing through. */
  background: 'solid' | 'transparent'
  /** What the pane is painted with: the surface's own, nothing, so what lies behind it shows through, or a color. */
  paneBackground: 'theme' | 'transparent' | `#${string}`
  /** Colors the person set, by their place in the palette. They hold on any surface; the rest follows the theme. */
  colors: Partial<Palette>
  /** Who sits at the top of the ring: the person, or the network with the person at the bottom. */
  layout: 'you-top' | 'you-bottom'
  /** With `reduced` nothing on the map flies, spreads or spins: what changes only fades. */
  motion: 'full' | 'reduced'
  /** The size of the words under the map, a step on the surface's own scale. A terminal has one size. */
  textSize: 'caption' | 'footnote' | 'body'
  /** How many rows the list under the map shows: 16, or as many as the desktop's docked pane has room for. */
  logRows: 16 | 'fill'
  /** How the map looks in a terminal: the rows alone, as always, or above them the map's picture, or the map in braille dots. */
  terminalView: 'text' | 'picture' | 'braille'
  /** How many times taller a terminal cell is than it is wide: what sizes the picture's box of cells. The engine does not say. */
  cellShape: number
}

/** Cell height over width as iTerm2 draws Monaco 12: the default. */
const CELL_SHAPE = 2.4

function cellShapeFrom(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(n) && n >= 1.2 && n <= 4 ? n : CELL_SHAPE
}

/** The stations an MCP server may be put on. Memory has `memoryServers`; the model and the hooks are not where a tool runs. */
const SERVER_STATIONS: readonly StationId[] = ['files', 'shell', 'web', 'browser', 'agents', 'skills', 'you']

/** An on-off option: `true` or `false`, or either word as a string, as a settings file written by hand may hold it. Anything else keeps the default. */
const flag = (v: unknown, byDefault: boolean): boolean => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : byDefault)

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(x => x !== '')

export function setupFrom(options: Readonly<Record<string, unknown>> = {}): Setup {
  const memoryLabels = new Map<string, string>()
  for (const pair of list(options.memoryLabels)) {
    const at = pair.indexOf('=')
    if (at > 0 && at < pair.length - 1) memoryLabels.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
  }
  // A server and a command are put on a station the same way: `name=station`, and an unknown station counts as not set.
  const stationsFrom = (value: unknown): Map<string, StationId> => {
    const chosen = new Map<string, StationId>()
    for (const pair of list(value)) {
      const at = pair.indexOf('=')
      const station = SERVER_STATIONS.find(id => id === pair.slice(at + 1).trim())
      if (at > 0 && station !== undefined) chosen.set(pair.slice(0, at).trim(), station)
    }
    return chosen
  }
  const serverStations = stationsFrom(options.serverStations)
  const commandStations = stationsFrom(options.commandStations)
  // The name is drawn as text on every surface: cleaned like a label, and cut by whole characters.
  const core = typeof options.coreName === 'string' ? [...clean(options.coreName)].slice(0, 10).join('').trim() : ''
  return {
    t: stringsFor(options.language),
    core: core === '' ? 'CLAUDE' : core,
    memoryServers: new Set(list(options.memoryServers)),
    memoryCommands: list(options.memoryCommands),
    memorySubcommands: new Set(list(options.memorySubcommands)),
    memoryPaths: list(options.memoryPaths),
    memoryLabels,
    serverStations,
    commandStations,
    hookRecords: flag(options.hookRecords, false),
    hookReasons: flag(options.hookReasons, false),
    guardedHooks: flag(options.guardedHooks, true),
    openAtStart: flag(options.openAtStart, true),
    subagentNames: flag(options.subagentNames, false),
    contextCost: flag(options.contextCost, false),
    contextWindow: options.contextWindow === 'compaction' ? 'compaction' : 'model',
    theme: options.theme === 'dark' || options.theme === 'light' ? options.theme : 'auto',
    background: options.background === 'transparent' ? 'transparent' : 'solid',
    paneBackground: paneBackgroundFrom(options.paneBackground),
    colors: colorsFrom(options.colors),
    layout: options.layout === 'you-bottom' ? 'you-bottom' : 'you-top',
    motion: options.motion === 'reduced' ? 'reduced' : 'full',
    textSize: options.textSize === 'caption' || options.textSize === 'body' ? options.textSize : 'footnote',
    logRows: options.logRows === 'fill' ? 'fill' : 16,
    terminalView: options.terminalView === 'picture' || options.terminalView === 'braille' ? options.terminalView : 'text',
    cellShape: cellShapeFrom(options.cellShape),
  }
}

/** `transparent`, or a color as `#rgb` or `#rrggbb`; anything else leaves the pane as the surface paints it. */
function paneBackgroundFrom(v: unknown): Setup['paneBackground'] {
  const value = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (value === 'transparent') return 'transparent'
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)?.[1]
  if (digits === undefined) return 'theme'
  return `#${digits.length === 3 ? [...digits].map(d => d + d).join('') : digits}`
}

/**
 * `accent=#ff9900, background=#101418` made into palette entries. A color goes into the drawing as it is written,
 * so only `#rgb` and `#rrggbb` pass; an unknown name or anything else counts as not set.
 */
function colorsFrom(v: unknown): Partial<Palette> {
  const out: Partial<Palette> = {}
  for (const pair of list(v)) {
    const at = pair.indexOf('=')
    const key = COLOR_NAMES[pair.slice(0, at).trim()]
    const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.exec(pair.slice(at + 1).trim())?.[0].toLowerCase()
    if (at < 1 || key === undefined || hex === undefined) continue
    out[key] = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  }
  return out
}
