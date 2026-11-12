/**
 * Antigravity adapter for lot-map.
 *
 * Maps Antigravity's documented plugin hooks to the shared event format.
 * Antigravity exposes lifecycle hooks through its plugin registration API;
 * this adapter listens to them and emits MapEvents without modifying any
 * execution state.
 *
 * REQUIRED HOOKS from Antigravity's plugin system:
 *   agent.tool.invoke   — fires before a tool runs   (id, tool, input)
 *   agent.tool.result   — fires after a tool returns  (id, status, result)
 *   agent.step.start    — model inference begins       (id, model, index, agentId?)
 *   agent.step.end      — model inference ends         (id, usage?)
 *   agent.message       — the user sent a message
 *   agent.turn.complete — a turn finished              (aborted)
 *   agent.spawn         — a sub-agent started          (agentId)
 *   agent.retire        — a sub-agent finished         (agentId)
 *
 * Install: register this file as an Antigravity plugin, or import
 * `createAntigravityAdapter` and pass the Antigravity plugin context.
 *
 * If Antigravity's hook names or shapes change, only this file needs updating;
 * the visualization and the shared event format stay the same.
 */
import type { EventStatus, HostAdapter, MapEvent, StationId, Unsubscribe } from './types'

/** The subset of the Antigravity plugin context this adapter needs. */
export interface AntigravityHooks {
  on(event: string, handler: (...args: unknown[]) => void): Unsubscribe
}

/** Minimal tool-invoke payload. Antigravity may pass more; we take only what the label needs. */
interface ToolInvoke {
  id: string
  tool: string
  description?: string
  agentId?: string
}

interface ToolResult {
  id: string
  status: 'ok' | 'error' | 'denied'
}

interface StepStart {
  id: string
  model: string
  index: number
  agentId?: string
}

interface StepEnd {
  id: string
  usage?: { contextPercent?: number }
}

interface TurnComplete {
  aborted: boolean
}

const now = (): number => Date.now()

/**
 * Classify an Antigravity tool name to a map station.
 * Antigravity tools use dot-separated namespaces; the first segment
 * tells us the category.
 */
function stationOf(tool: string): StationId {
  const ns = tool.split('.')[0]?.toLowerCase() ?? ''
  switch (ns) {
    case 'file': case 'read': case 'write': case 'edit': case 'grep': case 'glob': return 'files'
    case 'shell': case 'bash': case 'terminal': return 'shell'
    case 'web': case 'fetch': case 'search': case 'http': return 'web'
    case 'browser': return 'browser'
    case 'agent': case 'spawn': return 'agents'
    case 'memory': return 'memory'
    case 'skill': return 'skills'
    case 'ask': case 'user': case 'prompt': return 'you'
    default: return 'shell'
  }
}

function statusOf(s: ToolResult['status']): EventStatus {
  switch (s) {
    case 'ok': return 'ok'
    case 'error': return 'err'
    case 'denied': return 'block'
  }
}

/** A label safe for display: the tool name or a short description, never the full input. */
function labelOf(tool: string, description?: string): string {
  if (description && description.length <= 120) return description
  const parts = tool.split('.')
  return parts[parts.length - 1] ?? tool
}

export function createAntigravityAdapter(hooks: AntigravityHooks): HostAdapter {
  return {
    host: 'antigravity',
    hasModelInfo: true,
    hasContextInfo: true,

    subscribe(emit: (event: MapEvent) => void): Unsubscribe {
      const unsubs: Unsubscribe[] = []

      unsubs.push(hooks.on('agent.tool.invoke', (...args: unknown[]) => {
        const e = args[0] as ToolInvoke
        emit({
          kind: 'tool_start',
          id: e.id,
          station: stationOf(e.tool),
          label: labelOf(e.tool, e.description),
          from: e.agentId ? 'agents' : 'core',
          agentId: e.agentId,
          timestamp: now(),
        })
      }))

      unsubs.push(hooks.on('agent.tool.result', (...args: unknown[]) => {
        const e = args[0] as ToolResult
        emit({ kind: 'tool_end', id: e.id, status: statusOf(e.status), timestamp: now() })
      }))

      unsubs.push(hooks.on('agent.step.start', (...args: unknown[]) => {
        const e = args[0] as StepStart
        emit({
          kind: 'model_step',
          id: e.id,
          model: e.model,
          stepIndex: e.index,
          agentId: e.agentId,
          timestamp: now(),
        })
      }))

      unsubs.push(hooks.on('agent.step.end', (...args: unknown[]) => {
        const e = args[0] as StepEnd
        emit({
          kind: 'model_step_end',
          id: e.id,
          context: e.usage?.contextPercent,
          timestamp: now(),
        })
      }))

      unsubs.push(hooks.on('agent.message', () => {
        emit({ kind: 'user_message', timestamp: now() })
      }))

      unsubs.push(hooks.on('agent.turn.complete', (...args: unknown[]) => {
        const e = args[0] as TurnComplete
        emit({ kind: 'answer', aborted: e.aborted, timestamp: now() })
      }))

      unsubs.push(hooks.on('agent.retire', (...args: unknown[]) => {
        const e = args[0] as { agentId: string }
        emit({ kind: 'agent_done', agentId: e.agentId, timestamp: now() })
      }))

      return () => { for (const u of unsubs) u() }
    },
  }
}
