# Changelog

What changed in each version of lot-map, newest first. To get a new version, see [Updating](README.md#updating).

## 0.7.0 (2026-11-13)

- In VS Code the line of now has three buttons. **Zoom out** and **Zoom in** draw the map at one of six widths, and **Hide map** folds the pane to one line; what you chose is kept for the next session. The desktop app and the terminal are as they were. Contributed by 5m0k3. (#57, #59)
- The terminal picture follows the terminal: with `theme` on `auto` it is light on a light terminal that sets `COLORFGBG` (iTerm2, rxvt, Konsole), where it used to be dark on white. Where nothing says, it stays dark. Contributed by jwechsler. (#49)
- Fixed in a terminal: the line of now had no colour of its own and was black on Claude Code's dark pane under a light profile. It takes the theme's text colour. (#58)
- Built-in tools that lit Shell land by what they are for: the task list, plan mode and notifications on You, schedules and routines on Agents, the skill and plugin catalogue on Skills, an artifact's comments and data and Claude Projects on Network. Each label is the tool's name. Contributed by anand-krishanu. (#60)
- The browser reached from a cloud session linked to your computer lights Browser, where it lit Network. Contributed by anand-krishanu. (#50)
- README: the terminal picture needs Claude Code to draw in fullscreen, and how to turn that on; a section on the VS Code pane. (#58, #59)
- New page, [PRINCIPLES.md](PRINCIPLES.md): six things the mod holds to, the test or check behind each, and what was measured. (#61)
- PRIVACY.md and the README said a shell command's and a subagent's label may be the short description the model wrote; a monitor's is too, and they now say so. PRIVACY.md also has a paragraph on `COLORFGBG` and a line on the two values the VS Code pane keeps. (#61, #49, #59)
- Inside: the check on every pull request also holds the mod to the list of what it hooks and calls, `scripts/surface.txt`; the marketplace has a description; the bug form asks whether the reporter will send a fix. (#61, #62, #63)

## 0.6.0 (2026-11-12)

- The rows under the map are one line each. A row used to be one string and wrapped when its label was long, so the rows slid sideways and changed height while the work went on. Now the words are cut at the pane's edge and the time stands in a column at the right. (#46)
- A row with a long label has a `▸`: press it to read the row whole, and again to close it. One row is open at a time.
- What took no time, such as a message arriving, shows a dash in the time column, and the answer's row shows how long the whole turn took.
- The line of now says only what runs. In a terminal it also has the context percentage and the model at its right; beside the drawing it leaves them to the drawing. The model on that line was contributed by gandharvahardikar. (#41)
- New option `textSize`: `caption`, `footnote` or `body` for the rows under the map.
- New option `terminalView`: with `picture`, a terminal that shows pictures (iTerm2 3.5 and later, kitty, Ghostty) gets the map itself above the rows, painted by the mod from the same drawing as the desktop app's. Off by default. `cellShape` fits the picture to the terminal's cells. Contributed by buddyatkins. (#33)
- New option `motion`: with `reduced`, nothing on the map flies, spreads or spins; a call still lights its station and its spoke, and what changes only fades. (#40)
- The Russian line for when nothing runs is shorter: "Ожидание".
- The demo and the screenshots are made again with the new rows.
- README: the install in two steps, for when Claude Code answers that the plugin is not found in any marketplace; and what a search is called on the map. (#44, #39)
- Inside: `hooks/map.ts` is split into `setup`, `palette`, `classify`, `draw` and `feed`, and still hands the same names on; a check validates and tests every pull request and every push to `main` and `next`. (#45, #35, #43)

## 0.5.3 (2026-11-12)

- Portuguese labels: `language` takes `pt`. Contributed by Obsessi0n. (#31)
- A shell command behind `sudo`, `env`, `time`, `timeout`, `nohup`, `nice`, `xargs`, `command` or `exec` is read as the command it runs: `sudo curl` lights Network, where it used to light Shell.
- Fixed: `find … -exec curl` lit Files, the station for commands that work on files and nothing else. `find` with `-exec` is now read by the command it runs.
- More commands light Network: `git -C dir push`, `python -m pip install`, `uv`, `pipx`, `poetry`, `pnpm dlx`, `npx -y`, `docker compose pull`, `go get`, `apt install`.
- `rm` and `rmdir` light Files.
- Fixed: a typed slash command could drop the row of a background task still running, once more than 80 rows had passed since it began.
- Control characters are taken out of a typed slash command's name, as out of every other label.
- An MCP tool's name with doubled underscores reads with single spaces.

## 0.5.2 (2026-11-12)

- Fixed: for a web address with an IPv6 host and an `@` in its path or query, the label could show the text after the `@` instead of the host: `https://[::1]/x?tok=@secret` was drawn as `secret`. It now shows `[::1]`, and `[::1]:8080` keeps its port. Contributed by markedwardcampos. (#29)

## 0.5.1 (2026-11-11)

- The MP4 copy of the demo is back at `docs/demo.mp4`, where links from outside point; it was removed in 0.3.9. The README links to it again.

## 0.5.0 (2026-11-11)

- Back on the Hooks station: the rows for a hook that asked for permission and for a check that took a moment. They went in 0.4.0, when the hook that sees them was removed for a plugin catalogue's rules; that catalogue takes mods only from organizations it has verified, so the hook is back as it was in 0.3.9.
- The README and the privacy page say what that hook does: it reads what settings hooks decided and hands the decision on unchanged.

## 0.4.2 (2026-11-11)

- A privacy page, [PRIVACY.md](PRIVACY.md): what the mod is handed, what it keeps and what it does not do. `plugin.json` links to it. The map itself is unchanged.

## 0.4.1 (2026-11-11)

- More for a plugin catalogue's listing: a support link to this repository's issues, and keywords. The map itself is unchanged.

## 0.4.0 (2026-11-11)

- The mod no longer has a hook on permission checks. A settings hook's refusal is read from the error the refused call returns, so a refused call and the hook that stopped it still show, with the first line of the reason when `hookReasons` is on.
- Gone with that hook: the rows for a hook that asked for permission and for a check that took a moment.
- The README says what each of the mod's hooks does.

## 0.3.9 (2026-11-11)

- What a plugin catalogue shows about the mod: an icon, the author, and links to this repository. The map itself is unchanged.
- The MP4 copy of the demo is no longer in the repository; the GIF in the README shows the same session.

## 0.3.8 (2026-11-11)

- Italian labels: `language` takes `it`. Contributed by kesi26. (#20)

## 0.3.7 (2026-11-11)

- Background work stays on the map until it ends: a command sent to the background, a monitor, a background subagent or a workflow keeps its row open, and the row closes when the task reports back. A task that failed leaves a fault on its station. (#17)
- A background task's report is no longer drawn as a new message of yours.
- Monitor has its own label on the Shell station.

## 0.3.6 (2026-11-11)

- New option `colors`: colours of your own, by name, as `name=#rrggbb`. (#15)

## 0.3.5 (2026-11-11)

- The route is softer on a light surface, and each leg fades by itself: it stays for 40 seconds and fades over 20. (#14)

## 0.3.4 (2026-11-11)

- The PowerShell tool is read the same way as Bash, with PowerShell's own command names. (#13)
- A quoted path with a space is read as one word, and a Windows program is read by its name: `CURL.EXE` is `curl`.

## 0.3.3 (2026-11-11)

- Windows paths with backslashes are read: the label of a file, the memory folders and the names of commands. Contributed by davidkinsler. (#11)

## 0.3.2 (2026-11-11)

- New option `background`: with `transparent` the map leaves its ground out and the surface shows through. (#10)

## 0.3.1 (2026-11-11)

- Fixed: a password in a web address could reach a label when the address was written in an unusual way. An address that can be read two ways now shows only its scheme. (#6)
- A hook's refusal shows the name of the tool it stopped; its first line shows only with the new option `hookReasons`.
- The word after a memory command shows only if it is listed in the new option `memorySubcommands`.
- A name in `memoryCommands` counts when it is the command itself or begins with it and `-`, `_` or `.`.
- More commands light Network: `rsync`, `nc`, `sftp`, `npm install`, `docker pull` and the like, also inside `$(…)`.
- Control characters are taken out of every label.

## 0.3.0 (2026-11-10)

- New option `layout`: `you-bottom` turns the ring so that you are at the bottom and the network at the top.

## 0.2.0 (2026-11-10)

- The route: a thin line joins the last stations in order.
- Spokes wear in with use, and two clock hands grow around a station while a call runs.
- Memory has a colour of its own; what a hook brought unasked is drawn and counted apart.
- A ring around the centre shows how full the context window is.
- A change of model rings at the centre and gets a row of its own.
- Subagents circle the Agents station.
- Calls that start together fly side by side; a fault leaves a dot until the next message; finished calls at one station fold into one row.
- A light palette and the option `theme`; with `auto` the map follows a light or a dark surface by itself.

## 0.1.0 (2026-11-09)

- The first version: a pane beside the chat with ten stations that light up as memory, files, shell, the network, the model, agents, skills and hooks are used.
- Labels in English, Russian, Spanish, French and German.
