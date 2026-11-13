# Principles

Six things lot-map holds to. Each has a check that anyone can run, so none of them rests on a promise. An idea for the map is weighed against them first; [how](#weighing-an-idea) is at the end.

Run the checks from the repository's root:

```bash
claude plugin test .
```

```bash
node scripts/check-surface.mjs
```

CI runs both on every pull request. The tests named below are in [`hooks/principles.test.tsx`](hooks/principles.test.tsx) unless another file is given.

## 1. It watches and changes nothing

Every hook hands the event on as it came and returns what came back as it was. No input, result, prompt, context or permission decision is touched, and the mod never refuses anything.

**Checked by:**

- `principle 1: every hook hands on the event it was given and returns what came back`: eight events, each sent through the mod with a hook beneath it that records what arrived and answers with a marked value.
- `principle 1: a refusal comes back as it was written…`: a refusal from a plugin beneath and one from a settings hook.
- `a model step streams through untouched…` in `hooks/lot-map.test.tsx`, for the one event that streams.
- `scripts/check-surface.mjs` fails if the mod hooks an event that can change what the model is sent or what is allowed (`prompt.compose`, `session.append`, `tool.describe`, `tool.check`).

## 2. A label holds a name, never content

What a call carries stays in the call. The map shows a file's last two path parts, an address's host, a tool's name, a record's number. Three labels are words the model wrote for the row and are shown as written, up to 120 characters: the short description of a shell command, of a monitor and of a subagent. [PRIVACY.md](PRIVACY.md) has the whole list.

The mod makes no network request, reads no file, runs no process and calls no model. What it keeps is the session's rows and, between sessions, the last model's name and two values of the VS Code pane.

**Checked by:**

- `principle 2: no tool puts content on its label, whatever its input carries`: 57 tool names, each called with a mark in every field that holds content (command line, pattern, query, file text, prompt, plan, the first parts of a path, an address's login, path and query).
- `principle 2: nothing a session carries reaches what the mod keeps or draws`: the same calls, a message, a hook's refusal and a hook's context sent through the mod; the mark is in nothing written to the session's state or the store, and in no text on the pane.
- `scripts/check-surface.mjs` holds the mod to [`scripts/surface.txt`](scripts/surface.txt): 13 hooks, 13 engine calls, one environment variable read (`COLORFGBG`), one state key. A new call or read fails the check until that file is changed, so it shows in the pull request. Whatever the file says, a call to `$.fs`, `$.process`, `$.model`, `$.agent`, `$.tool` or `$.audio`, or a `fetch` in the code, fails it.

## 3. It costs next to nothing

No tokens: the mod calls no model and adds nothing to the conversation or the prompt (principles 1 and 2 check that). What it does cost is time on your machine, and that is measured.

| What | Measured | Budget in the test |
| --- | --- | --- |
| Naming a call (`classify`), an ordinary mix of seven calls | 13 µs | 0.5 ms |
| Drawing the map with 80 rows, five calls running, three subagents | 80 µs | 2 ms |
| Folding 80 rows for the list under the map | 2 µs | 0.2 ms |
| A tool call through the mod and the test kit, start to end | 1.5 ms | 15 ms |
| The same after 300 more calls | 1.2 to 1.4 ms | three times the first |
| Naming a call whose command line is a 19,000-character script | 15 ms | 150 ms |

Measured on 2026-11-13, Apple M1 Pro, Claude Code 2.1.321, after a warm-up, three runs. The budgets are many times the figures so that a slow CI runner passes; they catch a change of kind, not of degree.

**What the figures do not say:**

- The 1.5 ms is the mod together with the test kit that stands in for the engine. In a live session the engine's own share is not measured.
- Reading a command line takes about a microsecond a character, growing in a straight line: 2 to 3 ms for 2,000 characters of piped commands, 15 to 30 ms for 20,000, 140 to 290 ms for 200,000. Commands of that size are rare (a file written through a heredoc), and the time is spent before the call runs. It is the one cost here that is not next to nothing.
- The terminal picture (`terminalView: picture`, off by default) paints up to thirty frames a second while the map moves. Its cost per frame has no test here.

**Checked by:** `principle 3: naming a call, drawing the map and folding the rows each stay within their budget` and `principle 3: a tool call through the mod stays within its budget…`. Both print their figures: `claude plugin test . | grep COST`.

## 4. A fault on the map never reaches the work

A broken board must not stop a tool call, a message or a turn. It is held twice: every engine call the mod makes goes through `quietly`, which swallows a failure, and no hook has a `.catch`, so the engine skips a hook that fails and carries on with the event. (`claude plugin validate` lists these as `gating hook without .catch`. For a mod that guards something that would be a fault; for one that only watches it is the point.)

**Checked by:**

- `principle 4: with the engine refusing every call the mod makes, each event still goes through`: state, store, clock and usage all throw; eight events still return what came from beneath.
- `a broken board never stops the tool` and `a broken board never stops a model step` in `hooks/lot-map.test.tsx`.

## 5. A calm map

The map has a fixed set of things on it: ten stations, a spoke to each, the core, one line of now, one line per row. New information goes into one of those or into an option. It does not get an element of its own, because each one more makes the rest harder to read.

This is the one principle a test cannot prove, only fence:

- `principle 5: ten stations, a label of at most 120 characters, and a drawing that does not grow with the session`: after the first eighty calls the drawing has as many elements at five thousand calls as at eighty.
- `a row is one line…` in `hooks/lot-map.test.tsx`.

Whether a change keeps the map calm is decided by looking at it: a pull request that changes the drawing comes with a picture.

## 6. It works with nothing set, and what you have stays

The mod needs no setup. Every option has a default, and a new option's default keeps the behaviour people already have.

**Checked by:**

- `principle 6: every option left unset behaves as its documented default` and `principle 6: with no options set, the engine hands the mod its documented defaults`.
- `scripts/check-surface.mjs` holds the defaults in that test to the ones in `.claude-plugin/plugin.json`.
- `options that make no sense count as not set` in `hooks/lot-map.test.tsx`.

## Weighing an idea

Before an idea becomes an issue or a pull request, five questions:

1. Does it need the mod to change an event, or to refuse one? Then it is not for this mod.
2. Does it put content on the map, or make the mod read or keep something new? Then PRIVACY.md and `scripts/surface.txt` change with it, and it needs a reason that outweighs that.
3. Does it add work to every tool call, or to every frame? Then it comes with a figure from the cost tests.
4. Does it add an element to the map? Then try first whether an existing element or an option can carry it.
5. Does it change what people see or get without setting anything? Then it is an option, off by default.

An idea that passes all five is mostly a matter of taste and time. One that does not can still be right, but it changes what the mod is, and that is decided in an issue first.
