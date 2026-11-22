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
- `with subagentNames a subagent's step says which subagent it is…` and `with subagentNames a refused spawn comes back as it was written…` in the same file, for a subagent's start, which the mod hooks only with that option on.
- `scripts/check-surface.mjs` fails if the mod hooks an event that can change what the model is sent or what is allowed (`prompt.compose`, `session.append`, `tool.describe`, `tool.check`).

## 2. A label holds a name, never content

What a call carries stays in the call. The map shows a file's last two path parts, an address's host, a tool's name, a record's number. A shell line with no description is labelled with its command's name only if that is a command the mod knows by name or one named in the options, and with the word `shell` otherwise: three times a word of the line's content was read as its command and shown (0.13.0, 0.13.2 and the review of 0.13.2), and a list of names cannot show a word it does not hold. Three labels are words the model wrote for the row and are shown as written, up to 120 characters: the short description of a shell command, of a monitor and of a subagent. [PRIVACY.md](PRIVACY.md) has the whole list.

The mod makes no network request, reads no file, runs no process and calls no model. What it keeps is the session's rows and, between sessions, the last model's name and two values of the VS Code pane.

**Checked by:**

- `principle 2: no tool puts content on its label, whatever its input carries`: 87 tool names, each called with a mark in every field that holds content (command line, pattern, query, file text, prompt, plan, the first parts of a path, an address's login, path and query, a resource's address).
- `principle 2: nothing a session carries reaches what the mod keeps or draws`: the same calls, a message, a hook's refusal and a hook's context sent through the mod; the mark is in nothing written to the session's state or the store, and in no text on the pane.
- `principle 2: of what the context holds, asked for with contextWindow compaction, only the window's size is kept or drawn`: the engine's answer names memory files, MCP tools, agents, commands and skills, each with the mark; the ring reads 75%, so the answer was used, and the mark is in nothing written to the state or the store and in no text or drawing of the pane.
- `scripts/check-surface.mjs` holds the mod to [`scripts/surface.txt`](scripts/surface.txt): 15 hooks, 14 engine calls, five environment variables read (`COLORFGBG`, `TERM_PROGRAM`, `LC_TERMINAL`, `TERM_PROGRAM_VERSION`, `LC_TERMINAL_VERSION`), one state key. A new call or read fails the check until that file is changed, so it shows in the pull request. The file also lists what each call is given first, read from the source: the fields of an object written out, with the values written as text (`$.session.usage{breakdown='summary'}`), a name written out (`$.store.get('paneMin')`), and `(not written out)` for an argument handed over in a variable. So a call that asks for more than it did, as `$.session.usage` does with `breakdown`, changes the file too. What the check does not see: an argument after the first, the value behind a variable, and what the mod then does with an answer; tests hold that last one. Whatever the file says, a call to `$.fs`, `$.process`, `$.model`, `$.agent`, `$.tool` or `$.audio`, or a `fetch` in the code, fails it.

## 3. It costs next to nothing

No tokens: the mod calls no model and adds nothing to the conversation or the prompt (principles 1 and 2 check that). What it does cost is time on your machine, and that is measured.

| What | Measured | Budget in the test |
| --- | --- | --- |
| Naming a call (`classify`), an ordinary mix of seven calls | 13 µs | 0.5 ms |
| Drawing the map with 80 rows, five calls running, three subagents | 80 µs | 2 ms |
| Folding 80 rows for the list under the map | 2 µs | 0.2 ms |
| A tool call through the mod and the test kit, start to end | 1.5 ms | 15 ms |
| The same after 300 more calls | 1.2 to 1.4 ms | three times the first |
| Naming a call whose command line is a 19,000-character script | 0.4 ms | 20 ms |
| Reading a drawing for the terminal picture, once each time the board changes | 0.6 to 1.2 ms | 20 ms |
| A frame of the terminal picture, painted and packed into a PNG, with the map at rest | 11 to 12 ms | 100 ms |
| The same with 80 rows, five calls running, three subagents | 19 to 20 ms | 100 ms |

Measured on 2026-11-13, Apple M1 Pro, Claude Code 2.1.321, after a warm-up, three runs. The budgets are many times the figures so that a slow CI runner passes; they catch a change of kind, not of degree.

**What the figures do not say:**

- The 1.5 ms is the mod together with the test kit that stands in for the engine. In a live session the engine's own share is not measured.
- A command line is read up to its first 8,000 characters, and the text of a here-document is not read, but for the commands a bare mark's text runs in `$( )` and in backticks: a longer line is a script written inline, and what counts stands at its start. Ordinary piped commands take about a microsecond a character: 2 ms for 2,000 characters, 8 ms for 8,000 and for anything longer. The worst input found, 200,000 characters of one-letter commands joined by pipes, takes 36 ms, and a here-document of 200,000 characters 4.5 ms (measured on 2026-11-14, the same machine). Marks of a here-document are looked for in one pass over what is read, outside quotes and comments, and the command a mark stands in is looked at once: 1,000 marks on a line of 8,000 characters take 7 ms, where they took half a second through the mod and four times as long for twice as many. A command run by another, behind `find -exec`, inside `bash -c` or in a container, is followed up to 256 times in a line; a line that holds more is read no further and shown at Shell. Before this limit a `find -exec` nested nineteen deep held its call for ten seconds, twice as long with each level more; it now takes about a millisecond, and one six hundred deep 30 ms (measured on 2026-11-21, the same machine). The time is spent before the call runs.
- The terminal picture (`terminalView: picture`, off by default) is the one cost here that is not next to nothing. It paints up to five frames a second while the map moves and none while it stands still. A frame of 690 by 645 pixels takes 19 to 20 ms with the map at work, 7 of them painting and the rest packing the PNG: while something moves that is up to a tenth of one processor core, in the process the hooks run in. That share is this machine's: an outside reviewer's run of the same test on Linux in a container took 35.6 ms a frame, near a fifth of a core at five frames a second (2026-11-19). At first it painted thirty frames a second, six tenths of a core, and in kitty 0.50 on macOS none of them reached the screen while the map moved: of twenty shots of the window taken while a command ran, none showed a map at 33, 66 or 125 ms a frame, and all twenty did at 200 ms, fifteen different pictures in 2.8 s (measured on 2026-11-18). Why the quicker frames are not shown was not known then. It is how much is sent in a second, not how often: of eight pairs of frame size and pace watched in kitty 0.50 on 2026-11-22, the three that sent 399, 432 and 532 KB a second moved evenly, and the five that sent 635 KB or more lost the map now and then, among them the 664 KB a second of a 133 KB frame five times a second, which is what this picture sent until then (issue #110; the sizes are of a like drawing painted apart, not read from the terminal). Whether the limit is kitty's or Claude Code's is not known. So the picture is now 460 by 430 pixels, some 80 KB a frame, and a frame waits long enough for no second to send more than 450 KB. The times above are of the larger frame and have not been taken again for the smaller one. Measured on 2026-11-14, the same machine. What the terminal then spends showing the picture is not measured, with one exception: iTerm2 3.7.7 keeps every frame, about 2 MB each, until its tab is closed (17 GB in five minutes, measured on 2026-11-16), so in iTerm2 before 3.7.8 the picture is off. iTerm2 3.7.8 frees them: 1466 frames in four and a half minutes left it between 327 and 351 MB (measured on 2026-11-19).
- The braille map (`terminalView: braille`, off by default) paints up to eight frames a second while the map moves, and none at rest. A frame of the largest map, painted and packed, took 0.14 to 0.24 ms on an Intel Core Ultra 7 155H under Windows 11 (Claude Code 2.1.325, after a warm-up, three runs). `principle 3: a frame of the braille map…` in `hooks/braille.test.tsx` holds it under 5 ms and prints its figure with the others.
- `contextCost` (off by default) adds work to each model step of the main loop and none to a tool call beyond keeping its id: the step puts the context's growth on the calls it answered. A step through the mod and the test kit took 2.3 to 2.6 ms answering no call and 2.9 to 3.5 ms answering forty, on the Intel machine above (after a warm-up, twenty of each, three runs). `principle 3: a step that answers forty calls…` in `hooks/context.test.tsx` holds it under 15 ms and under three times a bare step.
- `contextWindow` set to `compaction` (off by default) asks the engine one more thing, how the context divides up, and the engine estimates the whole context to answer. It is asked at a session's first model step, at the first after a compaction and at the first on another model, never for a drawing. In a live session with 34k tokens in the context the answer took 15 ms, and the plain reading the ring always makes under 1 ms (one reading, 2026-11-19, the Apple M1 Pro, Claude Code 2.1.325). What it takes with a long session's context is not measured. With `guardedHooks` off the mod does not hear of a compaction, so there it asks again only on a change of model.

**Checked by:** `principle 3: naming a call, drawing the map and folding the rows each stay within their budget`, `principle 3: a tool call through the mod stays within its budget…`, `principle 3: a frame of the terminal picture stays within its budget…` and the braille map's test of the same kind. All print their figures: `claude plugin test . | grep COST`.

## 4. A fault on the map never reaches the work

A broken board must not stop a tool call, a message or a turn. It is held twice: every engine call the mod makes goes through `quietly`, which swallows a failure, and no hook has a `.catch`, so the engine skips a hook that fails and carries on with the event. (`claude plugin validate` lists these as `gating hook without .catch`. For a mod that guards something that would be a fault; for one that only watches it is the point.)

One hook does more than pass the event on after it: `tool.call` reads the result that came back, to tell a call that went on in the background, and its `catch` hands a failure on as it came. A failure in that reading would look like the tool's own. It cannot come from the result: a result must be plain data, what JSON holds, and the engine refuses anything else before the mod's hook sees it (the test below holds this on the engine the tests run on). Looking in plain data for a task's id throws nothing, and closing the row goes through `quietly`.

**Checked by:**

- `principle 4: with the engine refusing every call the mod makes, each event still goes through`: state, store, clock and usage all throw; eight events still return what came from beneath.
- `principle 4: a result that could fail when read never reaches the mod: the engine hands a hook plain data alone`: a result whose fields throw when read is refused by the engine as not plain data.
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
