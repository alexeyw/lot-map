// `keepClosed`: the sessions the map is turned off in, by the pane's close mark or `/lot-map off`. Off by default; with
// the option off, nothing here is reached.
import type { EngineInterface, PaneCloseInput } from 'claude-code'

import { quietly } from './board'

/** Where the list is kept, in the plugin's own store: the session's id and nothing else. */
const OFF_KEY = 'offSessions'
/** How many sessions are remembered; the oldest is forgotten first, and opens as any session does. */
export const OFF_KEPT = 200

/** The ids in what the store gave back: anything that is not a short id is dropped, so the list holds ids alone. */
export function idsOf(kept: unknown): string[] {
  if (!Array.isArray(kept)) return []
  return kept.filter((one): one is string => typeof one === 'string' && one.length > 0 && one.length <= 128)
}

/** Whether the person turned the map off in this session. Where the session or the store cannot be read, it is on. */
export async function isOff($: EngineInterface): Promise<boolean> {
  const off = await quietly(async () => {
    const id = await $.session.id()
    return idsOf(await $.store.get(OFF_KEY)).includes(id)
  })
  return off === true
}

/** Turns the map off, or on again, for this session alone. A failure leaves the list as it was. */
export async function setOff($: EngineInterface, off: boolean): Promise<void> {
  await quietly(async () => {
    const id = await $.session.id()
    const ids = idsOf(await $.store.get(OFF_KEY)).filter(one => one !== id)
    if (off) ids.push(id)
    await $.store.set(OFF_KEY, ids.slice(-OFF_KEPT))
  })
}

/**
 * The `ui.close` hook: it only looks. The close goes on first and its answer comes back as it was, whatever the mod's
 * own calls then do; only a close by the person's mark or key turns the session off.
 */
export async function afterClose<R>($: EngineInterface, e: PaneCloseInput, next: (e: PaneCloseInput) => Promise<R>, said: string): Promise<R> {
  const closed = await next(e)
  // Not awaited: a call of the mod's that hangs or fails keeps nothing waiting.
  if (e.origin.kind === 'person') {
    void quietly(async () => {
      await setOff($, true)
      // Awaited, though a toast answers nothing, so that one that failed later would still be caught here.
      await $.ui.toast(said)
    })
  }
  return closed
}
