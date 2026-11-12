/**
 * VS Code adapter interface for lot-map.
 *
 * STATUS: adapter interface only. No working adapter ships today because
 * no VS Code AI extension exposes a public event API for tool-call observation.
 *
 * WHAT WAS CHECKED (November 2026):
 *
 * 1. vscode.lm namespace — lets extensions *make* language-model requests,
 *    but does not let one extension observe another's requests or tool calls.
 *    There is no `onDidInvokeTool` or equivalent event.
 *
 * 2. GitHub Copilot extension — its chat participants and inline completions
 *    are internal; the extension does not expose a tool-call event stream,
 *    an MCP hook, or a public API beyond `@participant` registration.
 *
 * 3. Continue, Cline, Aider — each has its own internal event model.
 *    Continue has an event bus but it is not a stable public API.
 *    Cline logs to an output channel but does not emit structured events.
 *    Aider runs as a subprocess with no VS Code extension API surface.
 *
 * WHAT WOULD MAKE THIS WORK:
 *
 * - A VS Code AI extension that fires `onDidStartToolCall` / `onDidEndToolCall`
 *   events through `vscode.extensions.getExtension(id)?.exports`, or
 * - A shared MCP server that the AI extension connects to, letting this adapter
 *   observe the tool-call stream as an MCP client, or
 * - An output-channel parser for a specific extension's structured log format
 *   (fragile; breaks on format changes).
 *
 * To implement a concrete adapter for a specific provider:
 * 1. Confirm the provider exposes one of the above mechanisms.
 * 2. Implement `HostAdapter.subscribe` to listen and emit MapEvents.
 * 3. Register the adapter in the VS Code extension's `activate` function.
 *
 * The `HostAdapter` interface from `./types` is the contract. An adapter
 * for a provider that cannot supply model identity or context usage should
 * set `hasModelInfo` / `hasContextInfo` to false; the map will show those
 * fields as unavailable rather than displaying stale values.
 */
import type { HostAdapter, MapEvent, Unsubscribe } from './types'

/**
 * Skeleton for a VS Code adapter. Replace the subscribe body with
 * provider-specific event observation once a supported API exists.
 *
 * Example for a hypothetical extension that exposes an event emitter:
 *
 * ```ts
 * import * as vscode from 'vscode'
 * import type { MapEvent } from './types'
 *
 * const ext = vscode.extensions.getExtension('provider.ai-agent')
 * const api = ext?.exports
 * if (api?.onToolCall) {
 *   api.onToolCall((e: { id: string; tool: string; status: string }) => {
 *     emit({ kind: 'tool_start', id: e.id, station: 'shell', label: e.tool, timestamp: Date.now() })
 *   })
 * }
 * ```
 */
export function createVSCodeAdapter(): HostAdapter {
  return {
    host: 'vscode',
    hasModelInfo: false,
    hasContextInfo: false,

    subscribe(_emit: (event: MapEvent) => void): Unsubscribe {
      // No provider-specific event source is wired yet.
      // When a concrete provider API becomes available, subscribe to its
      // events here and call _emit with the appropriate MapEvent.
      return () => {}
    },
  }
}

/**
 * Registry of VS Code AI providers and their event-API status.
 * Updated November 2026. Check each provider's changelog before relying on this.
 */
export const PROVIDER_STATUS: ReadonlyArray<{
  name: string
  extensionId: string
  hasEventAPI: boolean
  notes: string
}> = [
  {
    name: 'GitHub Copilot',
    extensionId: 'github.copilot',
    hasEventAPI: false,
    notes: 'No public tool-call event stream. Chat participants are internal.',
  },
  {
    name: 'Continue',
    extensionId: 'continue.continue',
    hasEventAPI: false,
    notes: 'Internal event bus exists but is not a stable public API.',
  },
  {
    name: 'Cline',
    extensionId: 'saoudrizwan.claude-dev',
    hasEventAPI: false,
    notes: 'Logs to output channel; no structured event emitter.',
  },
]
