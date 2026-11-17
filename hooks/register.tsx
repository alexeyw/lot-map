import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Entry, StationId, Status } from '../types'
import { MAP_ASPECT, STATIONS, classify, clean, describeNow, drawMap, firstLine, foldRows, formatMs, formatTokens, memoryIds, nowParts, setupFrom, shortModel, taskNotice, taskOf } from './map'
import type { Setup } from './map'
import { drawTerminalMap, terminalMap } from './terminal'

const PANE = 'lot-map'
const KEEP = 80
/** A label longer than this may not fit a docked pane, so its row gets a control that opens it. */
const LONG_LABEL = 28
/** The least the time takes at the end of a row, so that short times line up: `107 ms`. A longer one widens its own row. */
const TIME_COLUMN = 6
/** The same with `contextCost`, which puts what a call added to the context after its time: `85 ms ~+42k`. */
const TIME_AND_COST_COLUMN = 12
/**
 * One step's growth of the context is shared evenly among its calls when there are at most this many. With more, an
 * even share says too little: a large read and a short command would each show the same. Their rows then get no figure.
 */
const SHARED_AT_MOST = 3
const CREW = 12
/** How many subagents' names are kept for their rows. */
const CREW_NAMES = 32
/**
 * The widths, in CSS pixels, the editor may draw the map at. Its pane is a third of the panel tall and cannot be made
 * taller, so the person zooms the map out until it fits, rows and all. Past the last, the map is as wide as the pane.
 */
const ZOOMS = [160, 200, 240, 280, 340, 400]

// Change the tag when a field of Entry or Board changes: it declines what an earlier version stored.
const board = atom({ plugin: 'lot-map', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-4' })

const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

type Start = {
  station: StationId
  label: string
  from?: Entry['from']
  status?: Status
  agentId?: string
  mark?: Entry['mark']
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt'>>
}

/** The newest rows, and beside them every background task still going, however long ago it started. */
const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

const isFault = (status: Status): boolean => status === 'err' || status === 'block'

const oneMore = (faults: Board['faults'], station: StationId): Board['faults'] => ({ ...faults, [station]: (faults?.[station] ?? 0) + 1 })

async function begin($: EngineInterface, start: Start): Promise<string | undefined> {
  return quietly(async () => {
    const now = await $.clock.now()
    const entry: Entry = {
      id: newId(now),
      station: start.station,
      label: clean(start.label),
      from: start.from ?? 'core',
      startedAt: start.startedAt ?? now,
      status: start.status ?? 'run',
      ...(start.status !== undefined ? { endedAt: start.endedAt ?? now } : {}),
      ...(start.agentId !== undefined ? { agentId: start.agentId } : {}),
      ...(start.mark !== undefined ? { mark: start.mark } : {}),
    }
    await update($, board, b => ({
      ...b,
      ...start.patch,
      entries: kept([...b.entries, entry]),
      counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
      // What a hook brought to memory unasked is counted apart from what was asked for.
      ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
      // An interrupted turn lands on the person's own station and is no fault of anything.
      ...(isFault(entry.status) && entry.station !== 'you' ? { faults: oneMore(b.faults, entry.station) } : {}),
      ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId)
        ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) }
        : {}),
    }))
    return entry.id
  })
}

async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      return {
        ...b,
        ...patch,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(open !== undefined && isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** The call started work that goes on after it answered: its row stays open under the task's id. */
async function background($: EngineInterface, id: string | undefined, task: string): Promise<void> {
  if (id === undefined) return
  await quietly(() => update($, board, b => ({ ...b, entries: b.entries.map(e => (e.id === id && e.status === 'run' ? { ...e, task } : e)) })))
}

/** A background task ended: its row closes, as a fault when the task failed. */
async function settle($: EngineInterface, task: string, status: Status): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.task === task && e.status === 'run')
      if (open === undefined) return b
      return {
        ...b,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
      }
    })
  })
}

/** How full the context window is, as the status line has it, and its tokens; costs nothing. */
async function contextOf($: EngineInterface): Promise<{ patch: Pick<Board, 'context'>; tokens: number | undefined }> {
  const context = await quietly(async () => (await $.session.usage()).context)
  return {
    patch: typeof context?.percent === 'number' ? { context: context.percent } : {},
    tokens: typeof context?.tokens === 'number' ? context.tokens : undefined,
  }
}

/**
 * What one step of the main loop added to the context, put on the calls whose answers it was sent with.
 *
 * The engine reads the context as the input a response was answered over, so the calls of step N show in the reading
 * of step N+1, and `before` and `after` are those two readings. The growth also holds the model's own words, what a hook
 * added and, at the start of a turn, the message: an estimate, as the README says. A context that shrank, as at a
 * compaction, puts nothing anywhere.
 *
 * One call takes all of it. Up to SHARED_AT_MOST share it evenly, marked as shared. Past that the rows get nothing, but
 * when every call of the step was at one station there is no doubt where it went, and that station's sum gets it whole.
 */
async function charge($: EngineInterface, calls: readonly string[], before: number | undefined, after: number | undefined): Promise<void> {
  if (before === undefined || after === undefined || calls.length === 0 || after <= before) return
  const grown = after - before
  await quietly(() =>
    update($, board, b => {
      const own = b.entries.filter(e => calls.includes(e.id))
      if (own.length === 0) return b
      const share = own.length <= SHARED_AT_MOST ? grown / own.length : undefined
      const spent = { ...b.spent }
      const add = (station: StationId, tokens: number): void => {
        spent[station] = Math.round((spent[station] ?? 0) + tokens)
      }
      if (share !== undefined) for (const e of own) add(e.station, share)
      else if (new Set(own.map(e => e.station)).size === 1 && own[0] !== undefined) add(own[0].station, grown)
      return {
        ...b,
        spent,
        entries:
          share === undefined
            ? b.entries
            : b.entries.map(e => (calls.includes(e.id) ? { ...e, tokens: Math.round(share), ...(own.length > 1 ? { shared: true } : {}) } : e)),
      }
    }),
  )
}

/** What a settings hook added to the context: shown as the hook acting and, when it brought records, as memory. */
async function noteContext($: EngineInterface, context: readonly string[] | undefined, when: string, setup: Setup): Promise<void> {
  const { t } = setup
  const text = (context ?? []).join('\n')
  if (text.trim() === '') return
  const ids = setup.hookRecords ? memoryIds(text) : []
  if (ids.length === 0) {
    await begin($, { station: 'hooks', label: t.addedContext(when), status: 'ok' })
    return
  }
  await begin($, { station: 'hooks', label: t.addedMemory(when), status: 'ok' })
  const shown = ids.slice(0, 6).map(id => `#${id}`).join(' ')
  await begin($, {
    station: 'memory',
    label: t.records(ids.length, `${shown}${ids.length > 6 ? ' …' : ''}`),
    from: 'inbound',
    status: 'ok',
  })
}

/** What the person set in the editor's pane: the map folded away, or zoomed. Kept between sessions: never what it shows. */
async function setView($: EngineInterface, view: Pick<Board, 'minimized' | 'zoom'>): Promise<void> {
  await update($, board, b => ({ ...b, ...view }))
  if ('minimized' in view) await $.store.set('paneMin', view.minimized === true)
  if ('zoom' in view) await $.store.set('mapZoom', view.zoom ?? null)
}

/** One step of zoom out (-1) or in (+1) from a width; undefined is the pane's whole width. */
function zoomStep(zoom: number | undefined, by: -1 | 1): number | undefined {
  const at = zoom === undefined ? ZOOMS.length : ZOOMS.indexOf(zoom)
  return ZOOMS[Math.min(ZOOMS.length, Math.max(0, (at < 0 ? ZOOMS.length : at) + by))]
}

export const register: Register = (on, options) => {
  const setup = setupFrom(options)
  const { t } = setup
  // The feed's second column fits the longest station name of the language.
  const column = Math.max(8, ...Object.values(t.stations).map(name => name.length))

  // Calls a settings hook refused, so that the tool's own row reads as blocked and not as an error.
  // Loses nothing across a reload that matters: a reload never lands in the middle of a call.
  const refused = new Set<string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'

  // The pane as it is opened: with `paneBackground` set, the surface paints that under it, or nothing.
  const pane = { id: PANE, title: t.title, ...(setup.paneBackground === 'theme' ? {} : { backgroundColor: setup.paneBackground }) }

  // In a terminal, the map above the rows, as a picture or in braille dots, for a person who asked for it.
  const above = terminalMap(setup)

  // With `contextCost`: the main loop's calls since its last model step, and the context that step was answered over.
  // Lost with a reload, which costs at most one step's figures.
  let waiting: string[] = []
  let lastTokens: number | undefined

  on('session.start', async ($, e, next) => {
    await quietly(() => $.command.register({ name: 'lot-map', description: t.command }))
    void quietly(() => $.ui.open(pane))
    await quietly(async () => {
      const minimized = (await $.store.get('paneMin')) === true
      const kept = await $.store.get('mapZoom')
      const zoom = typeof kept === 'number' && ZOOMS.includes(kept) ? kept : undefined
      await update($, board, b => ({ ...b, minimized, zoom }))
    })
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    return next(e)
  })

  on('command.run', { command: 'lot-map' }, async $ => {
    const opened = await $.ui.open(pane)
    return { text: opened.isPlaced ? t.opened : t.cannotOpen(String(opened.reason)) }
  })

  on('turn.start', async ($, e, next) => {
    const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer.
      await quietly(() => update($, board, b => (b.faults === undefined ? b : { ...b, faults: {} })))
      await begin($, { station: 'you', label: t.newMessage, from: 'inbound', status: 'ok' })
    }
    return next(e)
  })

  // Which subagent is which, by the few words it was started with: the same words its row on Agents already shows.
  // Kept for the labels of its model steps and nowhere else; the newest CREW_NAMES of them.
  const crew = new Map<string, string>()
  if (setup.subagentNames) {
    on('agent.spawn', async ($, e, next) => {
      const started = await next(e)
      try {
        const name = clean(e.description, 40)
        if (started.agentId !== undefined && name !== '') {
          crew.set(started.agentId, name)
          for (const id of crew.keys()) {
            if (crew.size <= CREW_NAMES) break
            crew.delete(id)
          }
        }
      } catch {
        // A name that cannot be kept is no reason to trouble the spawn.
      }
      return started
    })
  }

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain && lastModel !== e.model) {
      const before = lastModel
      lastModel = e.model
      void quietly(() => $.store.set(modelKey, e.model))
      if (before !== undefined) {
        const now = await quietly(() => $.clock.now())
        await begin($, {
          station: 'model',
          label: `${shortModel(before)} → ${shortModel(e.model)}`,
          status: 'ok',
          mark: 'switch',
          uncounted: true,
          ...(now !== undefined ? { patch: { switchedAt: now } } : {}),
        })
      }
    }
    // The calls whose answers this step is sent with: those made since the last step. A call this step starts is the next one's.
    const answered = isMain ? waiting : []
    if (isMain) waiting = []
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${crew.get(e.agentId ?? '') ?? t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      ...(isMain ? { patch: { model: e.model, step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      if (isMain) {
        const context = await contextOf($)
        await finish($, id, 'ok', context.patch)
        if (setup.contextCost) {
          await charge($, answered, lastTokens, context.tokens)
          lastTokens = context.tokens
        }
      } else {
        await finish($, id, 'ok')
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent's loop is over: it leaves the agents station, and a call of its that never reported back is settled.
      const agentId = e.agentId
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          agents: (b.agents ?? []).filter(id => id !== agentId),
          entries: b.entries.map(x => (x.status === 'run' && (x.agentId === agentId || x.task === agentId) ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    } else {
      // What the last step's calls added would show only in the next turn's first reading, beside the next message: none.
      waiting = []
      await begin($, {
        station: 'you',
        label: e.isAborted ? t.turnAborted : t.answerReady,
        status: e.isAborted ? 'err' : 'ok',
        ...(e.isAborted ? {} : { mark: 'done' as const }),
      })
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          entries: b.entries.map(x => (x.status === 'run' && x.from === 'core' && x.task === undefined ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = await quietly(async () => {
      const seen = classify(e.tool, e as unknown as Record<string, unknown>, setup)
      return begin($, { ...seen, ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }) })
    })
    // A subagent's calls fill its own context, which the engine does not report: only the main loop's are counted.
    if (setup.contextCost && id !== undefined && e.agentId === undefined) waiting.push(id)
    try {
      const ran = await next(e)
      const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
      const task = wasRefused || ran.isError === true ? undefined : taskOf(ran.result)
      if (task !== undefined) {
        await background($, id, task)
        return ran
      }
      await finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok')
      return ran
    } catch (failure) {
      await finish($, id, 'err')
      throw failure
    }
  })

  // On a Team or Enterprise login a guard of the organisation's runs ahead of every mod and sends these five
  // events on past it, with a notice in the transcript each time. With `guardedHooks` off the mod adds no hook
  // on them, so there is nothing to skip and nothing to say.
  if (setup.guardedHooks) {
    on('classic.PreToolUse', async ($, e, next) => {
      const startedAt = (await quietly(() => $.clock.now())) ?? 0
      const decided = await next(e)
      const endedAt = (await quietly(() => $.clock.now())) ?? startedAt
      if (decided.deny !== undefined) {
        if (e.tool_use_id !== undefined) refused.add(e.tool_use_id)
        await begin($, { station: 'hooks', label: (setup.hookReasons ? firstLine(decided.deny) : '') || t.stopped(e.tool), status: 'block', startedAt })
      } else if (decided.ask !== undefined) {
        await begin($, { station: 'hooks', label: t.askedPermission(e.tool), status: 'ok', startedAt, endedAt })
      } else if (endedAt - startedAt >= 400) {
        // A check that took a moment is worth seeing; the instant ones are not.
        await begin($, { station: 'hooks', label: t.checkBefore(e.tool), status: 'ok', startedAt, endedAt })
      }
      return decided
    })
  }

  // A notification delivered into a running turn starts no turn of its own; this is where it is seen.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      if (e.origin?.kind !== 'task-notification') return
      const notice = taskNotice(e.text)
      if (notice?.status !== undefined) await settle($, notice.id, notice.status)
    })
    return next(e)
  })

  if (setup.guardedHooks) {
    on('classic.UserPromptSubmit', async ($, e, next) => {
      const result = await next(e)
      await noteContext($, result.additionalContext, t.toMessage, setup)
      return result
    })

    on('classic.SessionStart', async ($, e, next) => {
      const result = await next(e)
      await noteContext($, result.additionalContext, t.atStart, setup)
      return result
    })

    on('skill.prompt', async ($, e, next) => {
      const result = await next(e)
      // A skill the model called is already on the map as its tool call; this one catches a typed slash command.
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => {
          const label = clean(e.skill)
          if (b.entries.some(x => x.station === 'skills' && x.status === 'run' && x.label === label)) return b
          const entry: Entry = { id: newId(now), station: 'skills', label, from: 'core', startedAt: now, endedAt: now, status: 'ok' }
          return { ...b, entries: kept([...b.entries, entry]), counts: { ...b.counts, skills: (b.counts.skills ?? 0) + 1 } }
        })
      })
      return result
    })

    on('session.compact', async ($, e, next) => {
      const id = await begin($, { station: 'model', label: t.compacting })
      // After a compaction the context starts again: no call before it gets a figure, and the next step only sets the mark.
      waiting = []
      lastTokens = undefined
      try {
        return await next(e)
      } finally {
        await finish($, id, 'ok', (await contextOf($)).patch)
      }
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, board)
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
                  onPress={() => void quietly(() => update($, board, b => ({ ...b, open: isOpen ? undefined : entry.id })))}
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
  })
}
