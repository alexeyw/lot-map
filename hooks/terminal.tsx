// The terminal picture (`terminalView: picture`): the desktop map's drawing painted to pixels, and the loop of frames that keeps it moving.
import type { EngineInterface, RenderElement, RenderInputOf } from 'claude-code'

import type { Board } from '../types'
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

function schedule($: EngineInterface, picture: Picture, delay: number | undefined): void {
  picture.timer?.cancel()
  picture.timer = undefined
  if (delay === undefined) return
  try {
    // A fault in a frame must never reach the work, as `quietly` keeps it in register.tsx.
    picture.timer = $.clock.after(delay, () => void tick($, picture).catch(() => undefined))
  } catch {
    // No timer: the picture stays still.
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
  if (picture.isSchemeUnknown) {
    picture.isSchemeUnknown = false
    try {
      const scheme = schemeFrom(await $.env.get('COLORFGBG'))
      if (scheme !== undefined) picture.setup = { ...picture.setup, theme: scheme }
    } catch {
      // Nothing to read: the picture stays dark, which is no reason to lose it.
    }
  }
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
  schedule($, picture, picture.showsPictures ? next : Math.min(PROBE_MS, next ?? PROBE_MS))
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
  schedule($, picture, next === undefined ? undefined : Math.round(Math.max(next - spent, next / 3)))
}
