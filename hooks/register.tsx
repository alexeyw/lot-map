// The hooks: what the mod listens to, and what each puts on the board. The board is in `board.ts`, the pane's
// drawing in `pane.tsx`, the sums of `contextCost` in `cost.ts`.
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'
import { background, begin, change, charge, compactionWindowOf, contextOf, finish, kept, newId, quietly, settle } from './board'
import { stepCosts } from './cost'
import { TASK_TOOLS, classify, clean, firstLine, keepNewest, memoryIds, setupFrom, shortModel, taskNotice, taskOf } from './map'
import type { Setup } from './map'
import { ZOOMS, drawPane } from './pane'
import { terminalMap } from './terminal'

const PANE = 'lot-map'
/** How many subagents' names are kept for their rows. */
const CREW_NAMES = 32
/** How many refusals are remembered until their calls come by: a call that never comes would stay for the whole session. */
const REFUSALS_KEPT = 64

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

export const register: Register = (on, options) => {
  const setup = setupFrom(options)
  const { t } = setup

  // Calls a settings hook refused, so that the tool's own row reads as blocked and not as an error.
  // Loses nothing across a reload that matters: a reload never lands in the middle of a call.
  // The newest REFUSALS_KEPT of them: a refusal whose call never reaches `tool.call` is dropped in its turn.
  const refused = new Set<string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'
  // With `contextWindow` on `compaction`: the window, and the model it was measured for. Measuring costs a pass over the
  // context, so it waits for the step that follows a change, not for a drawing.
  let compactionWindow: number | undefined
  let measuredFor: string | undefined

  // The pane as it is opened: with `paneBackground` set, the surface paints that under it, or nothing.
  const pane = { id: PANE, title: t.title, ...(setup.paneBackground === 'theme' ? {} : { backgroundColor: setup.paneBackground }) }

  // In a terminal, the map above the rows, as a picture or in braille dots, for a person who asked for it.
  const above = terminalMap(setup)

  // With `contextCost`: which calls each step of the main loop answered, and what the context grew by over it.
  const costs = stepCosts(setup.contextCost)

  on('session.start', async ($, e, next) => {
    await quietly(() => $.command.register({ name: 'lot-map', description: t.command }))
    // Where no surface is attached yet, as in the desktop app at its start, an open has nowhere to go and the
    // engine says so in the transcript. The pane is opened once a surface joins instead. If the roster cannot
    // be read, the open is tried as before. With `openAtStart` off the pane waits for `/lot-map`.
    if (setup.openAtStart) {
      const surfaces = await quietly(() => $.session.surfaces())
      if (surfaces === undefined || surfaces.length > 0) void quietly(() => $.ui.open(pane))
    }
    await quietly(async () => {
      const minimized = (await $.store.get('paneMin')) === true
      const kept = await $.store.get('mapZoom')
      const zoom = typeof kept === 'number' && ZOOMS.includes(kept) ? kept : undefined
      await change($, b => ({ ...b, minimized, zoom }))
    })
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (setup.openAtStart) void quietly(() => $.ui.open(pane))
    return next(e)
  })

  on('command.run', { command: 'lot-map' }, async $ => {
    const opened = await $.ui.open(pane)
    return { text: opened.isPlaced ? t.opened : t.cannotOpen(String(opened.reason)) }
  })

  // What the last prompt that was not a task's notification would be read as, if it has the look of one: a task's id
  // and how it ended, and none of its text. A person's, a peer's, a trigger's. `turn.start` is not told where its
  // text comes from, and `prompt.submit` is.
  let pasted: ReturnType<typeof taskNotice>
  on('turn.start', async ($, e, next) => {
    // A message that only looks like a notification, pasted from a log, is a message.
    const read = e.agentId === undefined ? taskNotice(e.text) : undefined
    const notice = read !== undefined && read.id === pasted?.id && read.status === pasted.status ? undefined : read
    if (e.agentId === undefined) pasted = undefined
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer.
      await quietly(() => change($, b => (b.faults === undefined ? b : { ...b, faults: {} })))
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
          keepNewest(crew, CREW_NAMES)
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
    const answered = isMain ? costs.stepStarted() : []
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${crew.get(e.agentId ?? '') ?? t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      // The model's name is drawn as text too: cleaned like a label before it is kept.
      ...(isMain ? { patch: { model: clean(e.model, 60), step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      if (isMain) {
        if (setup.contextWindow === 'compaction' && measuredFor !== e.model) {
          measuredFor = e.model
          compactionWindow = await compactionWindowOf($)
        }
        const context = await contextOf($, compactionWindow)
        await finish($, id, 'ok', context.patch)
        await charge($, costs.stepEnded(answered, context.tokens))
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
        await change($, b => ({
          ...b,
          agents: (b.agents ?? []).filter(id => id !== agentId),
          entries: b.entries.map(x => (x.status === 'run' && (x.agentId === agentId || x.task === agentId) ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    } else {
      // What the last step's calls added would show only in the next turn's first reading, beside the next message: none.
      costs.turnEnded()
      await begin($, {
        station: 'you',
        label: e.isAborted ? t.turnAborted : t.answerReady,
        status: e.isAborted ? 'err' : 'ok',
        ...(e.isAborted ? {} : { mark: 'done' as const }),
      })
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        await change($, b => ({
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
    if (id !== undefined && e.agentId === undefined) costs.called(id)
    try {
      const ran = await next(e)
      const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
      const task = wasRefused || ran.isError === true || !TASK_TOOLS.has(e.tool) ? undefined : taskOf(ran.result)
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
        if (e.tool_use_id !== undefined) {
          refused.add(e.tool_use_id)
          keepNewest(refused, REFUSALS_KEPT)
        }
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
    if (e.origin !== undefined && e.origin.kind !== 'task-notification') pasted = taskNotice(e.text)
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
        await change($, b => {
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
      costs.compacted()
      try {
        return await next(e)
      } finally {
        // A compaction of the main conversation is measured again at the next step; a precompute installs nothing,
        // and a subagent's is not the main window.
        if (e.agentId === undefined && e.trigger !== 'precompute') measuredFor = undefined
        await finish($, id, 'ok', (await contextOf($, compactionWindow)).patch)
      }
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e, setup, above))
}
