// `contextCost`: which calls a model step answered, and how the context's growth over that step is put on them.
// Nothing here touches the engine: the board goes in and comes out, and the order of a step is in `stepCosts`.
import type { Board, StationId } from '../types'

/**
 * One step's growth of the context is shared evenly among its calls when there are at most this many. With more, an
 * even share says too little: a large read and a short command would each show the same. Their rows then get no figure.
 */
const SHARED_AT_MOST = 3

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
 *
 * The board comes back as it was when there is nothing to put anywhere.
 */
export function charged(b: Board, calls: readonly string[], before: number | undefined, after: number | undefined): Board {
  if (before === undefined || after === undefined || calls.length === 0 || after <= before) return b
  const grown = after - before
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
}

/** What a step that ended has to put on the board: the calls it answered, and the context before it and after. */
export type StepCost = { calls: readonly string[]; before: number | undefined; after: number | undefined }

/**
 * The main loop's calls and steps, in the order they come, for `contextCost`. A call made in one step is answered by
 * the next, so its figure is that next step's growth:
 *
 *   called → stepStarted (takes the calls made so far) → stepEnded (with the context read after it) → …
 *
 * Kept in the module's own memory and lost with a reload, which costs at most one step's figures. With `isOn` false
 * it keeps nothing and every step has nothing to put anywhere.
 */
export function stepCosts(isOn: boolean): {
  /** The main loop made a call: the next step is sent with its answer. */
  called(id: string): void
  /** A step of the main loop starts: the calls it answers are those made since the last one. */
  stepStarted(): readonly string[]
  /** That step ended, with the context read after it. What comes back is put on the board with `charged`. */
  stepEnded(answered: readonly string[], tokens: number | undefined): StepCost | undefined
  /** The turn is over: what the last step's calls added would show only beside the next message, so they get none. */
  turnEnded(): void
  /** The context starts again: no call before this gets a figure, and the next step only sets the mark. */
  compacted(): void
} {
  let waiting: string[] = []
  let lastTokens: number | undefined
  return {
    called(id) {
      if (isOn) waiting.push(id)
    },
    stepStarted() {
      const answered = waiting
      waiting = []
      return answered
    },
    stepEnded(answered, tokens) {
      if (!isOn) return undefined
      const cost = { calls: answered, before: lastTokens, after: tokens }
      lastTokens = tokens
      return cost
    },
    turnEnded() {
      waiting = []
    },
    compacted() {
      waiting = []
      lastTokens = undefined
    },
  }
}
