// The pane: the map, the line of now and the rows under it, drawn from the board for the surface that asked.
// Its buttons write the board and nothing else: a row opened to read, the editor's map folded or zoomed.
import type { EngineInterface, RenderElement, RenderInputOf, RenderSurface } from 'claude-code'

import type { Board } from '../types'
import { change, quietly, readBoard } from './board'
import { MAP_ASPECT, STATIONS, describeNow, drawMap, foldRows, formatMs, formatTokens, nowParts } from './map'
import type { Setup } from './map'
import { drawTerminalMap } from './terminal'
import type { TerminalMap } from './terminal'

/** A label longer than this may not fit a docked pane, so its row gets a control that opens it. */
const LONG_LABEL = 28
/** The least the time takes at the end of a row, so that short times line up: `107 ms`. A longer one widens its own row. */
const TIME_COLUMN = 6
/** The same with `contextCost`, which puts what a call added to the context after its time: `85 ms ~+42k`. */
const TIME_AND_COST_COLUMN = 12
/**
 * The widths, in CSS pixels, the editor may draw the map at. Its pane is a third of the panel tall and cannot be made
 * taller, so the person zooms the map out until it fits, rows and all. Past the last, the map is as wide as the pane.
 */
export const ZOOMS = [160, 200, 240, 280, 340, 400]

/** What the person set in the editor's pane: the map folded away, or zoomed. Kept between sessions: never what it shows. */
export async function setView($: EngineInterface, view: Pick<Board, 'minimized' | 'zoom'>): Promise<void> {
  await change($, b => ({ ...b, ...view }))
  if ('minimized' in view) await $.store.set('paneMin', view.minimized === true)
  if ('zoom' in view) await $.store.set('mapZoom', view.zoom ?? null)
}

/** One step of zoom out (-1) or in (+1) from a width; undefined is the pane's whole width. */
function zoomStep(zoom: number | undefined, by: -1 | 1): number | undefined {
  const at = zoom === undefined ? ZOOMS.length : ZOOMS.indexOf(zoom)
  return ZOOMS[Math.min(ZOOMS.length, Math.max(0, (at < 0 ? ZOOMS.length : at) + by))]
}

/** The pane's render input on any surface: `e.surface` narrows it. */
type PaneInput = { [P in RenderSurface]: RenderInputOf<'Pane', P> }[RenderSurface]

/** The pane as it stands now. `above` is the terminal's map, for a person who asked for one. */
export async function drawPane($: EngineInterface, e: PaneInput, setup: Setup, above: TerminalMap): Promise<RenderElement> {
  const { t } = setup
  // The feed's second column fits the longest station name of the language.
  const column = Math.max(8, ...Object.values(t.stations).map(name => name.length))
  const state = await readBoard($)
  const now = await $.clock.now()
  const { Box, Text, Button } = $.ui.resolve(e)
  const size = setup.textSize

  // How long each answer took, from the person's message to it: the one time a row of the moment has to show.
  const turnMs = new Map<string, number>()
  let askedAt: number | undefined
  for (const x of state.entries) {
    if (x.station === 'you' && x.from === 'inbound' && x.mark === undefined) askedAt = x.startedAt
    if (x.mark === 'done' && askedAt !== undefined) {
      turnMs.set(x.id, x.startedAt - askedAt)
      askedAt = undefined
    }
  }

  const rows = foldRows(state.entries, undefined, setup.subagentNames).map(({ entry, times, tookMs, tokens, isShared }) => {
    const isSwitch = entry.mark === 'switch'
    const mark = isSwitch ? '◆' : entry.status === 'run' ? '●' : entry.status === 'ok' ? '·' : '✕'
    const whole = turnMs.get(entry.id)
    // A row of one moment (a message, what a hook added) took no time: its place in the column holds a dash.
    const took = entry.endedAt === undefined ? t.running : whole !== undefined && whole > 0 ? formatMs(whole, t) : tookMs > 0 ? formatMs(tookMs, t) : '—'
    const isMoment = took === '—'
    // With `contextCost`, what the call added to the context stands after its time, in the time's own colour: whatever
    // reads on this theme for the time reads for the figure. A call whose step was not read yet has none.
    const cost = setup.contextCost && tokens !== undefined ? ` ${isShared ? '~' : ''}+${formatTokens(tokens)}` : ''
    // Theme keys, so the rows read on a light theme as well as on a dark one. A running row is not in Claude's own
    // colour: on a light theme that one stands next to the colour of a failure, and a running call read as a failed one.
    const color = entry.status === 'run' ? 'ide' : isSwitch ? 'claude' : entry.status === 'ok' ? undefined : 'error'
    const line = `${mark} ${t.stations[entry.station].padEnd(column)} ${entry.label}${times > 1 ? `  +${times - 1}` : ''}`
    const isDim = entry.status === 'ok' && !isSwitch
    // One row of the pane a row of the feed: the words are cut at the edge, the time keeps a column of its own at the
    // right, so a long label neither wraps nor pushes the time about. A long one can be opened, one at a time.
    const isLong = entry.label.length > LONG_LABEL
    const isOpen = isLong && state.open === entry.id
    return (
      <Box flexDirection="row" gap={1} alignItems="flex-start">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text mono size={size} color={color} dimColor={isDim} wrap={isOpen ? 'wrap' : 'truncate-end'}>
            {line}
          </Text>
        </Box>
        {isLong
          ? [
              <Button
                key={`open-${entry.id}`}
                plain
                dimColor
                label={isOpen ? '▾' : '▸'}
                onPress={() => void quietly(() => change($, b => ({ ...b, open: isOpen ? undefined : entry.id })))}
              />,
            ]
          : []}
        <Box flexShrink={0} minWidth={setup.contextCost ? TIME_AND_COST_COLUMN : TIME_COLUMN} justifyContent="flex-end">
          <Text mono tabular size={size} color={isMoment ? undefined : color} dimColor={isDim || isMoment} wrap="truncate-end">
            {`${took}${cost}`}
          </Text>
        </Box>
      </Box>
    )
  })
  const feed = rows.length > 0 ? rows : [<Text dimColor>{t.nothingYet}</Text>]
  // What runs now at the left, cut if it must be. Where there is no drawing to say them, the context and the model
  // stand at the right, whole; beside the drawing they would be said a second time.
  const now2 = nowParts(state, t)
  const what = now2.what
  const meter = e.surface === 'terminal' ? now2.meter : ''
  const current = (
    <Box flexDirection="row" gap={1} alignItems="flex-start">
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {/* The theme's own text colour: with none, a terminal draws its default, black on a light profile, over Claude Code's dark pane. */}
        <Text mono size={size} color="text" wrap="truncate-end">
          {what}
        </Text>
      </Box>
      {meter === ''
        ? []
        : [
            <Box flexShrink={0}>
              <Text mono tabular size={size} dimColor>
                {meter}
              </Text>
            </Box>,
          ]}
    </Box>
  )

  if (e.surface === 'terminal') {
    const tally = STATIONS.filter(s => (state.counts[s.id] ?? 0) > 0).map(s => `${t.stations[s.id]} ${state.counts[s.id]}`).join(' · ')
    const map = await quietly(() => drawTerminalMap($, e, state, now, above))
    return (
      <Box flexDirection="column">
        {map !== undefined ? [map] : []}
        {current}
        <Text dimColor>{tally === '' ? t.noCounts : tally}</Text>
        {feed}
      </Box>
    )
  }

  const { Svg } = $.ui.resolve(e)
  // The editor's pane cannot be made taller: there the person zooms the map or folds it away. Elsewhere, as before.
  if (e.surface === 'vscode' && state.minimized === true) {
    return (
      <Box flexDirection="row" gap={1} alignItems="flex-start">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {current}
        </Box>
        <Button key="show" plain dimColor label={t.showMap} onPress={() => quietly(() => setView($, { minimized: false }))} />
      </Box>
    )
  }
  const isEditor = e.surface === 'vscode'
  const zoom = isEditor ? state.zoom : undefined
  // Each station's share of the context is on the desktop map only, for now; the editor's map is drawn too small for it.
  const map = <Svg source={drawMap(state, now, setup, e.surface === 'desktop')}alt={`${t.title}. ${describeNow(state, t)}`} {...(zoom !== undefined ? { width: zoom, height: Math.round(zoom * MAP_ASPECT) } : {})} />
  if (!isEditor) {
    return (
      <Box flexDirection="column">
        {map}
        {current}
        {feed}
      </Box>
    )
  }
  // The pane is short, so its buttons take no row of their own: they share the line of now, at its right.
  return (
    <Box flexDirection="column">
      <Box key="map" flexDirection="row" justifyContent="center">
        {map}
      </Box>
      <Box flexDirection="row" gap={2} alignItems="flex-start">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {current}
        </Box>
        <Button key="zoom-out" plain dimColor label={t.zoomOut} onPress={() => quietly(() => setView($, { zoom: zoomStep(zoom, -1) }))} />
        <Button key="zoom-in" plain dimColor label={t.zoomIn} onPress={() => quietly(() => setView($, { zoom: zoomStep(zoom, 1) }))} />
        <Button key="hide" plain dimColor label={t.hideMap} onPress={() => quietly(() => setView($, { minimized: true }))} />
      </Box>
      {feed}
    </Box>
  )
}
