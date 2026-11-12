/**
 * Shared event format for lot-map.
 *
 * Host adapters translate platform-specific events into these types.
 * The visualization consumes them without knowing which host produced them.
 *
 * SAFETY INVARIANTS — every adapter must hold these:
 * - Labels carry names only: file basenames, hostnames, tool names.
 *   Never prompts, file contents, passwords, or full command arguments.
 * - All data stays on the device. Adapters must not send events to external services.
 * - Adapters observe activity without changing tool execution, permissions, or agent decisions.
 */

export type StationId =
  | 'you' | 'model' | 'memory' | 'files' | 'shell'
  | 'web' | 'browser' | 'agents' | 'skills' | 'hooks'

export type EventStatus = 'ok' | 'err' | 'block'

export type MapEvent =
  | { kind: 'tool_start'; id: string; station: StationId; label: string; from?: 'core' | 'agents'; agentId?: string; timestamp: number }
  | { kind: 'tool_end'; id: string; status: EventStatus; timestamp: number }
  | { kind: 'model_step'; id: string; model: string; stepIndex: number; agentId?: string; timestamp: number }
  | { kind: 'model_step_end'; id: string; context?: number; timestamp: number }
  | { kind: 'user_message'; timestamp: number }
  | { kind: 'answer'; aborted: boolean; timestamp: number }
  | { kind: 'agent_done'; agentId: string; timestamp: number }
  | { kind: 'compact_start'; id: string; timestamp: number }
  | { kind: 'compact_end'; id: string; context?: number; timestamp: number }
  | { kind: 'model_switch'; from: string; to: string; timestamp: number }

export type Unsubscribe = () => void

/**
 * A host adapter observes an AI agent's activity and emits MapEvents.
 *
 * Each host (Claude Code, Antigravity, VS Code) has its own adapter that
 * maps platform-specific hooks to the shared format. The visualization
 * layer consumes these events through the same Board/Entry model regardless
 * of which host produced them.
 *
 * `hasModelInfo` and `hasContextInfo` tell the visualization whether the
 * host can supply model identity and context-window usage. When false,
 * those fields are left blank rather than showing stale or made-up values.
 */
export interface HostAdapter {
  /** Short identifier: 'claude-code', 'antigravity', 'vscode' */
  readonly host: string

  /** Whether model identity is available from this host. */
  readonly hasModelInfo: boolean

  /** Whether context-window usage is available from this host. */
  readonly hasContextInfo: boolean

  /** Start observing. Returns a function that stops observation. */
  subscribe(emit: (event: MapEvent) => void): Unsubscribe
}
