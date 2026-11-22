// The board: what the map shows, kept in the session's state, and the few ways it is written. Every write goes
// through `quietly`, so that nothing that goes wrong here reaches the tool, the turn or the conversation.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Board, Entry, StationId, Status } from '../types'
import { charged } from './cost'
import type { StepCost } from './cost'
import { clean } from './map'

const KEEP = 80
const CREW = 12

// Change the tag when a field of Entry or Board changes: it declines what an earlier version stored.
const board = atom({ plugin: 'lot-map', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-4' })

/** The board as it stands. The engine lists what a module reads and writes from the file that names the atom, so every read and write of the board is made here. */
export function readBoard($: EngineInterface): Promise<Board> {
  return read($, board)
}

/** The board changed by `by`. Not quiet: the caller says what a failure may reach. */
export function change($: EngineInterface, by: (b: Board) => Board): Promise<unknown> {
  return update($, board, by)
}

export const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
export async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

export type Start = {
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

/** How many background tasks still going are kept beside the newest rows. */
const HELD = 40

/**
 * The newest rows, and beside them the background tasks still going, however long ago they started: the newest
 * `HELD` of those. More than that the board does not hold, so that it has an end whatever a session starts and
 * never hears of again; an older task that ends later closes no row.
 */
export const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  if (from <= 0) return entries
  let room = HELD
  const held = new Set<Entry>()
  for (let i = from - 1; i >= 0 && room > 0; i--) {
    const e = entries[i] as Entry
    if (e.status === 'run' && e.task !== undefined) {
      held.add(e)
      room--
    }
  }
  return entries.filter((e, i) => i >= from || held.has(e))
}

const isFault = (status: Status): boolean => status === 'err' || status === 'block'

const oneMore = (faults: Board['faults'], station: StationId): Board['faults'] => ({ ...faults, [station]: (faults?.[station] ?? 0) + 1 })

export async function begin($: EngineInterface, start: Start): Promise<string | undefined> {
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

export async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>): Promise<void> {
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
export async function background($: EngineInterface, id: string | undefined, task: string): Promise<void> {
  if (id === undefined) return
  await quietly(() => update($, board, b => ({ ...b, entries: b.entries.map(e => (e.id === id && e.status === 'run' ? { ...e, task } : e)) })))
}

/** A background task ended: its row closes, as a fault when the task failed. */
export async function settle($: EngineInterface, task: string, status: Status): Promise<void> {
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

/**
 * The auto-compact window, when it is below the model's. The call estimates the whole context, so it is made only at a
 * session's first model step, the first after a compaction and the first on another model, never for a drawing.
 */
export async function compactionWindowOf($: EngineInterface): Promise<number | undefined> {
  const context = await quietly(async () => (await $.session.usage({ breakdown: 'summary' })).context)
  const raw = context?.breakdown?.rawMaxTokens
  return typeof raw === 'number' && raw > 0 && raw < (context?.window ?? 0) && context?.breakdown?.isAutoCompactEnabled !== false ? raw : undefined
}

/**
 * How full the context window is, as the status line has it, and its tokens; costs nothing. With a `window`, the
 * auto-compact window from `compactionWindowOf`, the percentage is the tokens over that instead.
 */
export async function contextOf($: EngineInterface, window?: number): Promise<{ patch: Pick<Board, 'context'>; tokens: number | undefined }> {
  const context = await quietly(async () => (await $.session.usage()).context)
  const percent = window !== undefined && typeof context?.tokens === 'number' ? Math.min(100, Math.round((context.tokens / window) * 100)) : context?.percent
  return {
    patch: typeof percent === 'number' ? { context: percent } : {},
    tokens: typeof context?.tokens === 'number' ? context.tokens : undefined,
  }
}

/** With `contextCost`: what a step of the main loop added to the context, put on the calls it answered. */
export async function charge($: EngineInterface, cost: StepCost | undefined): Promise<void> {
  if (cost === undefined) return
  await quietly(() => update($, board, b => charged(b, cost.calls, cost.before, cost.after)))
}
