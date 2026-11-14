// The map above the rows in a terminal, for a person who asked for it, and the loop of frames that keeps it moving:
// the picture (`terminalView: picture`), the desktop map's drawing painted to pixels, or the braille map
// (`terminalView: braille`), the same board as cells, for a terminal that shows no pictures.
import type { EngineInterface, RenderElement, RenderInputOf } from 'claude-code'

import type { Board } from '../types'
import { brailleSize, nextFrameIn, packCells, paintBraille } from './braille'
import { describeNow, drawMap } from './map'
import type { Setup } from './map'
import { endlessEvery, imageSource, nextChangeIn, paint, parseMap, scaleFor } from './raster'
import type { Scene } from './raster'

const MAP_KEY = 'map'
/** Pixels per unit of the drawing: about what a docked pane shows on a sharp screen. The Image's size limit may take it lower. */
const SCALE = 1.5
/** Narrower than this the map cannot be read, and the pane stays text. */
const MAP_MIN_COLUMNS = 24
const MAP_MAX_COLUMNS = 72
/** Rows left under the map for the current action and the first rows of the feed. */
const FEED_ROWS = 6
/** How soon after the first picture the loop tries a frame, to learn whether this terminal shows pictures. */
const PROBE_MS = 100

/** The ANSI background indexes that are light: white (7) and the bright colours but bright black (9–15). */
const LIGHT_BACKGROUNDS = new Set([7, 9, 10, 11, 12, 13, 14, 15])

/**
 * The terminal's background from `COLORFGBG` (`fg;bg` or `fg;default;bg`, as iTerm2, rxvt and Konsole set it),
 * or undefined when it says nothing usable.
 */
export function schemeFrom(colorFgBg: string | undefined): 'light' | 'dark' | undefined {
  const last = (colorFgBg ?? '').trim().split(';').pop() ?? ''
  if (!/^\d{1,3}$/.test(last)) return undefined
  return LIGHT_BACKGROUNDS.has(Number(last)) ? 'light' : 'dark'
}

/** Only while something runs do the endless animations get frames. */
const isBusy = (board: Board): boolean => board.entries.some(x => x.status === 'run') || (board.agents ?? []).length > 0

/** The picture on show in a terminal, and the loop that keeps it moving between drawings. */
export type Picture = {
  setup: Setup
  /** The drawing on show, the pane it is on, when it was made, and whether anything runs. */
  shown: { scene: Scene; pane: string; drawnAt: number; isBusy: boolean } | undefined
  timer: { cancel: () => void } | undefined
  /** Whether this terminal shows pictures: unknown until the first frame, false once it drew the words instead. */
  showsPictures: boolean | undefined
  /** Under `auto`, until the first drawing has asked the terminal whether it is light or dark. */
  isSchemeUnknown: boolean
}

/** A map's next frame in `delay` ms, in place of the one it was waiting for; none with no delay. */
function schedule($: EngineInterface, map: Picture | Braille, delay: number | undefined, frame: () => Promise<void>): void {
  map.timer?.cancel()
  map.timer = undefined
  if (delay === undefined) return
  try {
    // A fault in a frame must never reach the work, as `quietly` keeps it in register.tsx.
    map.timer = $.clock.after(delay, () => void frame().catch(() => undefined))
  } catch {
    // No timer: the map stays still.
  }
}

/** Under `auto`, a map's first drawing asks the terminal, through COLORFGBG, whether it is light or dark; where that says nothing, the map stays dark. */
async function settleScheme($: EngineInterface, map: Picture | Braille): Promise<void> {
  if (!map.isSchemeUnknown) return
  map.isSchemeUnknown = false
  try {
    const scheme = schemeFrom(await $.env.get('COLORFGBG'))
    if (scheme !== undefined) map.setup = { ...map.setup, theme: scheme }
  } catch {
    // Nothing to read: the map stays dark, which is no reason to lose it.
  }
}

/** The terminal's picture for this setup, or none while `terminalView` is `text`. A reload starts afresh; the engine cancels the old timer. */
export function terminalPicture(setup: Setup): Picture | undefined {
  if (setup.terminalView !== 'picture') return undefined
  // Under `auto` the first drawing asks the terminal, through COLORFGBG; until then, or where it says nothing, dark.
  // No ground unless the person set a background colour.
  const pictureSetup: Setup = {
    ...setup,
    theme: setup.theme === 'auto' ? 'dark' : setup.theme,
    background: setup.colors.ground === undefined ? 'transparent' : setup.background,
  }
  return { setup: pictureSetup, shown: undefined, timer: undefined, showsPictures: undefined, isSchemeUnknown: setup.theme === 'auto' }
}

/** The picture above the rows for this board; its loop then keeps it moving. None in a pane too narrow, or a terminal that shows no pictures. */
export async function drawPicture($: EngineInterface, e: RenderInputOf<'Pane', 'terminal'>, board: Board, now: number, picture: Picture): Promise<RenderElement | undefined> {
  if (picture.showsPictures === false) return undefined
  await settleScheme($, picture)
  const { setup } = picture
  const { Image } = $.ui.resolve(e)
  const scene = parseMap(drawMap(board, now, setup))
  // Rows per column that keep the map round on cells `cellShape` times taller than wide.
  const perColumn = scene.height / scene.width / setup.cellShape
  const room = e.props.scroll.bodyRows - FEED_ROWS
  const columns = Math.min(e.props.bodyColumns, MAP_MAX_COLUMNS, room > 0 ? Math.floor(room / perColumn) : MAP_MAX_COLUMNS)
  if (columns < MAP_MIN_COLUMNS) {
    picture.shown = undefined
    return undefined
  }
  const busy = isBusy(board)
  picture.shown = { scene, pane: e.requestId, drawnAt: now, isBusy: busy }
  // This frame goes with the drawing; the loop sends the rest, and its first frame tells whether pictures show here.
  const next = nextChangeIn(scene, 0, endlessEvery(0, busy))
  schedule($, picture, picture.showsPictures ? next : Math.min(PROBE_MS, next ?? PROBE_MS), () => tick($, picture))
  return (
    <Image
      key={MAP_KEY}
      source={imageSource(paint(scene, 0, scaleFor(scene, SCALE)))}
      columns={columns}
      rows={Math.max(1, Math.round(columns * perColumn))}
      alt={`${setup.t.title}. ${describeNow(board, setup.t)}`}
    />
  )
}

/** The next frame of the drawing on show, in place of the last; then the one after, when it will look different. */
async function tick($: EngineInterface, picture: Picture): Promise<void> {
  picture.timer = undefined
  const drawing = picture.shown
  if (drawing === undefined) return
  const t = (await $.clock.now()) - drawing.drawnAt
  const sent = await $.ui.blit({ requestId: drawing.pane, key: MAP_KEY, source: imageSource(paint(drawing.scene, t, scaleFor(drawing.scene, SCALE))) })
  if (sent.deny !== undefined) {
    // Not on show any more, or the terminal draws the words instead; the engine says which only in words.
    if (picture.shown === drawing) picture.shown = undefined
    if (picture.showsPictures === undefined && /\balt\b/.test(sent.deny)) {
      picture.showsPictures = false
      $.ui.invalidate('ui.render')
    }
    return
  }
  picture.showsPictures = true
  if (picture.shown !== drawing) return
  const next = nextChangeIn(drawing.scene, t, endlessEvery(t, drawing.isBusy))
  // Less the time this frame took, but at least a third of the wait, to leave the mod's other hooks their turn.
  const spent = (await $.clock.now()) - drawing.drawnAt - t
  schedule($, picture, next === undefined ? undefined : Math.round(Math.max(next - spent, next / 3)), () => tick($, picture))
}

// ---- the braille map -----------------------------------------------------------------------------

/** The braille map on show in a terminal, and the loop that keeps it moving between drawings. */
export type Braille = {
  setup: Setup
  /** The board on show, the pane it is on, the cells it takes, and when it was drawn. */
  shown: { board: Board; pane: string; columns: number; rows: number; drawnAt: number } | undefined
  timer: { cancel: () => void } | undefined
  /** Under `auto`, until the first drawing has asked the terminal whether it is light or dark. */
  isSchemeUnknown: boolean
}

/** The terminal's braille map for this setup, or none unless `terminalView` is `braille`. A reload starts afresh; the engine cancels the old timer. */
export function terminalBraille(setup: Setup): Braille | undefined {
  if (setup.terminalView !== 'braille') return undefined
  // Light or dark as the picture is: under `auto` the first drawing asks the terminal, and until then, or where it says nothing, dark.
  return { setup: { ...setup, theme: setup.theme === 'auto' ? 'dark' : setup.theme }, shown: undefined, timer: undefined, isSchemeUnknown: setup.theme === 'auto' }
}

/** The braille map above the rows for this board; its loop then keeps it moving. None in a pane too small to read it in. */
export async function drawBraille($: EngineInterface, e: RenderInputOf<'Pane', 'terminal'>, board: Board, now: number, braille: Braille): Promise<RenderElement | undefined> {
  await settleScheme($, braille)
  const { setup } = braille
  const size = brailleSize(e.props.bodyColumns, e.props.scroll.bodyRows)
  if (size === undefined) {
    braille.shown = undefined
    return undefined
  }
  const { Raster } = $.ui.resolve(e)
  braille.shown = { board, pane: e.requestId, ...size, drawnAt: now }
  // This frame goes with the drawing; the loop sends the rest, and none while nothing on the map moves.
  schedule($, braille, nextFrameIn(board, now, setup), () => frame($, braille))
  return <Raster key={MAP_KEY} columns={size.columns} rows={size.rows} cells={packCells(paintBraille(board, now, setup, size.columns, size.rows))} />
}

/** The board on show as it looks now, in place of the last frame; then the one after, when it will look different. */
async function frame($: EngineInterface, braille: Braille): Promise<void> {
  braille.timer = undefined
  const shown = braille.shown
  if (shown === undefined) return
  const now = await $.clock.now()
  const cells = packCells(paintBraille(shown.board, now, braille.setup, shown.columns, shown.rows))
  const sent = await $.ui.blit({ requestId: shown.pane, key: MAP_KEY, cells, columns: shown.columns, rows: shown.rows })
  // Refused: the pane is closed, behind another one, or of another size by now. The next drawing starts the frames again.
  if (sent.deny !== undefined) {
    if (braille.shown === shown) braille.shown = undefined
    return
  }
  if (braille.shown !== shown) return
  const next = nextFrameIn(shown.board, now, braille.setup, now - shown.drawnAt)
  // Less the time this frame took, but at least a third of the wait, to leave the mod's other hooks their turn.
  const spent = (await $.clock.now()) - now
  schedule($, braille, next === undefined ? undefined : Math.round(Math.max(next - spent, next / 3)), () => frame($, braille))
}

// ---- which of them -------------------------------------------------------------------------------

/** What a terminal draws above the rows for this setup: the picture or the braille map, as the person chose. Neither falls back to the other. */
export type TerminalMap = { picture: Picture | undefined; braille: Braille | undefined }

export function terminalMap(setup: Setup): TerminalMap {
  return { picture: terminalPicture(setup), braille: terminalBraille(setup) }
}

/** The map above the rows for this board, or none: with `terminalView` on `text`, in a pane too small, or where the picture cannot show. */
export async function drawTerminalMap($: EngineInterface, e: RenderInputOf<'Pane', 'terminal'>, board: Board, now: number, map: TerminalMap): Promise<RenderElement | undefined> {
  if (map.picture !== undefined) return drawPicture($, e, board, now, map.picture)
  if (map.braille !== undefined) return drawBraille($, e, board, now, map.braille)
  return undefined
}
