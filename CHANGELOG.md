# Changelog

What changed in each version of lot-map, newest first. To get a new version, see [Updating](README.md#updating).

## 0.14.0 (2026-11-22)

What two reviews of 0.13.2 found, one from outside and one of the project's own: fourteen findings, all closed here. The first entry is a vulnerability by [SECURITY.md](SECURITY.md): a label that held content. Two things you may notice are marked **Changed**.

- **Changed**, and fixed: with no description, a shell line's label could be a word of its content. `N=$(grep hunter2 notes.txt | wc -l)` was labelled `hunter2`; so was the text of a here-document whose mark is `END-MSG`, `"END MSG"` or `1`, and of a PowerShell here-string with an apostrophe in it. Each earlier fix closed the form that was reported, so the rule is another now: the label is the command's name only if it is a command the mod knows by name (`git`, `make`, `curl` and the like) or one you named in `memoryCommands` or `commandStations`, and the word `shell` for anything else. A program of your own or a script, run with no description, is therefore labelled `shell` and no longer by its name. A line with a description is not touched. (#149)
- Fixed: an address with one slash after `https:`, or none, showed a part of its path: `https:/example.com/users/@hunter2` was labelled `hunter2`. (#149)
- **Changed**: with `memoryCommands` set, a line that runs a memory command and another command that reaches the network goes to Network, as it already did for `commandStations`. `recall search x; curl https://x.io` was Memory. (#152)
- Fixed: commands that reach the network and were shown on Files or Shell. A `#` after an escaped space or right after a closed `$( )` was taken for a comment; backticks inside backticks were not followed; a here-document's mark that is not shaped like a name (`EOF-1`, `E"O"F`) hid every line after it; a comment after `;`, a line joined by a backslash and a shift in `$[ ]` or in a quoted `$(( ))` misled the search for marks; a function's body was not read; `env --unset` and the long flags of `sudo`, `timeout` and `nice` were not known to take a word; an assignment after `if`, `{`, `!` or `do` stood for the command. A line longer than the 8,000 characters read is no longer shown as Files. (#150)
- Fixed: a PowerShell script block was not read: `gci | % { irm https://x.io }` was Files. (#150)
- Fixed: a here-document in backticks hid the lines after it when the backticks closed on its own line; and the text of a here-document with a bare mark, `<<EOF` and not `<<'EOF'`, was not read for what the shell runs in it: `cat > .env <<EOF` with `TOKEN=$(curl …)` was Files. (#153)
- Fixed: the board grew without end when a tool that is not Claude Code's answered with a field named `backgroundTaskId`: each call left a row that nothing closes, and the word from that field was kept in the session's state. Only the tools that start background work are read for a task now, and the board keeps the newest forty tasks still going. (#151)
- Fixed: a line of nothing but brackets, 7,800 characters, took 60 ms to read on the machine it was measured on; under 5 ms now. (#151)
- Fixed: the terminal picture's budget of 450 KB a second held the loop's frames only. Each drawing of the pane sent a frame past it, so a burst of calls could make the picture go away in kitty again. A drawing that comes too soon keeps the frame on show, and the loop sends the new one when it may. (#153)

## 0.13.2 (2026-11-22)

Fixes only. The first two come from a second outside review, of 0.13.1.

- Fixed: the text of a commit message was read as commands, since 0.13.0. Claude Code writes a commit as `git commit -m "$(cat <<'EOF' … EOF)"`, and a here-document inside `"$( )"` or backticks was not taken for one: a message with `(curl timeout)`, with `` `wget` `` or with a line beginning with `curl` lit Network. No label held the message. (#146)
- Fixed: `>|` was cut as a pipe, so with no description `>|SECRET make` was labelled `SECRET`, the file's name, and not `make`. It is a redirection now. (#146)
- Fixed: a call still running left the map once forty more calls had begun, while its row still said it ran: a background task's station went to rest, and the core with it. Both maps and the terminal picture now keep every running call. (#144)
- Fixed: in kitty the terminal picture went away now and then while the map moved. It is how much is sent in a second that counts: above some 530 to 630 KB a second kitty 0.50 stops showing the picture, and the picture sent about 660. It is now 460 by 430 pixels, two thirds of the size it was and less sharp, in every terminal, and a frame waits long enough for no second to send more than 450 KB. [PRINCIPLES.md](PRINCIPLES.md) has the eight measurements. (#145, #110)
- [SECURITY.md](SECURITY.md) counts a tool call held back as a vulnerability: the mod names a call before the call runs. (#146)

## 0.13.1 (2026-11-21)

- Vietnamese labels: `language` takes `vi`. The terminal picture's fonts get the two letters its station names need, `ạ` and `ỹ`, and the braille map lets through the letters Vietnamese writes with. Contributed by dung997tb. (#141)

## 0.13.0 (2026-11-21)

All but the new option come from a security review of 0.12.1. The first is a vulnerability by [SECURITY.md](SECURITY.md): a label that held content.

- Fixed: when Claude wrote no description for a shell line, the label was the first word of its first command, and that word could be a value. In PowerShell `$token = "ghp_…"; Invoke-RestMethod …` was labelled `ghp_…`, and `$env:KEY="…"`, `$h = @{…}` and a JSON body did the same; in the shell `<<<"…" gh auth login` and `TOKEN[0]=… ./deploy.sh` did. A command now begins past the assignments and the redirections before it, in PowerShell what is kept in a variable is the command only when it is a bare name, and a label that is not shaped like a name is the word `shell`. A line with a description was never touched by this. (#135)
- Fixed: an address with a backslash was shown with the wrong host. `https://attacker.example\@github.com/x` read `github.com`, while a browser goes to `attacker.example`; the label is `attacker.example` now. (#135)
- Fixed: a short command line could hold its tool call for seconds. A `find` with one `-exec` inside another and no `\;` between them was read twice as long with each one more: nineteen deep, 250 characters, held the call for six seconds. Each `-exec` is read once now, and one line follows at most 256 commands run by other commands; a line with more is read no further and shown at Shell. Nineteen deep takes about a millisecond. (#136)
- Fixed: a `<<` inside quotes or a comment hid the lines after it, so `grep -n "std::cout << value" src/main.cpp` with `curl` on the next line was Files; it is Network. And a line of many `<<` cost the square of its length: 8,000 characters took half a second and 48,000 six; both take 8 ms. Here-documents are found in one pass now, outside quotes and comments. `bash -s 2>&1 <<EOF` is read as a shell with no script, so what it runs is seen. (#137)
- New option `commandStations`: put a shell command on a station of your choice, each as `command=station`, with the stations `serverStations` takes. A name counts as it does in `memoryCommands` and is found wherever a command is, behind `sudo`, in `bash -c`, in a container. The command stays where you put it whatever its own name says; another command on the line that reaches the network still takes the line to Network; Memory wins when a command is in both. None is set by default. Contributed by lizhuojunx86. (#103, #111)
- A label loses every character that takes no room and changes how the rest reads: the zero-width space, the soft hyphen, U+061C and the separators of lines and paragraphs went through before. The zero-width joiner and non-joiner stay, for emoji of several parts and the scripts written with them. A label is cut by whole characters, so no cut leaves half an emoji. The core's name and the model's name are cleaned the same way. (#138)
- Fixed: a message that began like a background task's notification, pasted from a log, was taken for one: it got no row, and the task named in it was closed. (#138)
- PRINCIPLES.md: the limit on followed commands and what a nested line and a line of here-document marks cost, beside the other costs of reading a line. (#136, #137)
- Inside: the test of principle 2 reads shell lines with no description; a test of principle 4 holds the time a nested line keeps its call; the test of a long line's cost takes the middle of five readings. (#135, #136, #138)

## 0.12.1 (2026-11-20)

- Fixed: a `case` was not read by its branches. The `|` of a pattern cut it in two, so `case x in a|b) ls;; *) cat f;; esac` got the label `b)` at the Shell station, and a command on the line of the `case` itself was not read at all. A pattern is now read to its bracket and is no command, and what each branch runs is: that line is `ls` at Files. A network command in a branch shows as Network, as before. (#132)
- Fixed: a line that begins with a word of the shell which only sets something went to Shell: `local x=1; ls`, `unset X; ls`, `pushd d; ls; popd`. `local`, `declare`, `typeset`, `readonly`, `unset`, `shopt`, `umask`, `pushd`, `popd` and `wait` now say nothing either way, as `export` and `cd` did, so these are Files. `source`, `.`, `eval`, `trap` and `alias` stay Shell's. (#130)
- The six on-off options are read one way: `true`, `false`, or either word as a string, as a settings file written by hand may hold it; anything else keeps the default. Before, `guardedHooks` took the string `'false'`, `openAtStart` did not, and `hookRecords`, `hookReasons`, `subagentNames` and `contextCost` took no string. Set through `claude plugin configure` nothing changes. (#130)
- README: the title is Lot Map for Claude Code, and it links a [page that plays the map in the browser](https://alexeyw.github.io/lot-map/) on the mod's own code. (#129)
- Inside: the check holds the seven stills of [docs/options.md](docs/options.md) against what the mod paints now, pixel by pixel, so a change to the drawing that leaves a picture behind fails; `background-transparent.png` is painted again for it, laid over its colour by the script and not by ffmpeg; the tests name `console`, and the validator's seven warnings are gone. (#130, #131)

## 0.12.0 (2026-11-19)

- New option `openAtStart`: with `false` the pane stays closed when a session starts and opens on `/lot-map` alone. The map is kept from the session's first call all the same, so it is whole when it is opened. `true`, as before, stays the default. Suggested by Thombutter. (#116, #117)
- The terminal picture is back in iTerm2, from iTerm2 3.7.8 on. iTerm2 3.7.7 kept every picture it was sent, so since 0.9.0 the mod drew none there; iTerm2 fixed that on its side. Measured in 3.7.8: 1466 frames in four and a half minutes left its memory between 327 and 351 MB. An earlier iTerm2, or one that does not give its version, keeps the rows and a line that says why. For this the mod reads `TERM_PROGRAM_VERSION` or `LC_TERMINAL_VERSION`, which PRIVACY.md names. Confirmed over a day of use by castigator. (#81, #118)
- A time of an hour or more reads in hours and minutes: `1 h 5 min` where it read `65 min 0 s`, and `24 h 0 min` for a task that ran a day. Under an hour nothing changes. (#121)
- Fixed: the list of a bash array was read as a command, so `arr=(a b c); ls` got the label `b` at the Shell station. The list is now read to its closing bracket and is no part of the command; a command run inside it, or kept in it to be run later, still shows as Network. (#124)
- A new page, [docs/options.md](docs/options.md), shows the options that change what you see with a picture of each value, and `motion` as two GIFs. `scripts/option-pictures.mjs` paints the map's pictures with the mod's own code. (#126)
- PRINCIPLES.md: what `contextWindow` set to `compaction` costs (15 ms at a session's first step with 34k tokens in the context; a long session is not measured), that with `guardedHooks` off the window is read again only on a change of model, and that the terminal picture's share of a processor core is the measuring machine's. (#122)
- Inside: the surface check lists what each engine call is given first, so a call that asks for more than it did changes `scripts/surface.txt` (the `breakdown` of `contextWindow` had not), it reads every file of `hooks/`, and it runs under `TERM=linux`; two more tests of the principles; `hooks/raster.ts` is three files, `scene.ts`, `raster.ts` and `png.ts`; three more tests have the time they take on a slow runner. (#119, #120, #123, #125)

## 0.11.0 (2026-11-19)

- New option `contextWindow`: with `compaction` the ring and its percentage measure the context against the auto-compact window, such as one set with `autoCompactWindow`, where it is smaller than the model's; at 450k tokens of a 1M model with compaction at 600k it reads 75%, not 45%. `model`, as before, stays the default. For this the mod asks Claude Code how the context divides up, at a session's first model step and again after a compaction or a change of model, and takes only the window's size from the answer; PRIVACY.md says so. Contributed by philarete173. (#97, #101)
- New option `logRows`: with `fill`, in the desktop app's docked pane the list under the map takes the rows the pane has left below the map. The oldest rows that do not fit are cut off at the bottom, above the calls still running. `16`, as before, stays the default; a terminal, the editor and the mobile app keep 16. Contributed by philarete173. (#98, #102)
- `contextCost`: each station's sum is on every drawing of the map, where it was on the desktop map alone: VS Code's map and the terminal picture show `9 · 180k`, the braille map writes it after the count, `Files 9 +180k`, and a terminal that shows the rows alone has it in its line of counts. The braille map draws the sums for every station or for none: where its grid has no room for them all, the names stay whole and the rows keep their figures. Contributed by Obsessi0n. (#80, #105)
- Fixed: the terminal picture was painted up to thirty times a second, and in kitty none of those frames reached the screen while the map moved; the picture came back only when everything stood still. It now gets a frame five times a second, and each is shown: measured in kitty 0.50 on macOS, of twenty shots of the window taken while a command ran, none showed a map at 33 ms a frame and all twenty did at 200 ms. That is about a tenth of a processor core where it was six tenths. Why the quicker frames are not shown is not known. (#109, #110)
- Fixed: a row's time could show a part as large as the next unit: `1 min 60 s`, `60.0 s`, `1000 ms`. A time is now rounded before its unit is chosen, so 119.5 seconds reads `2 min 0 s`; a time exactly on half a tenth rounds up, so 1150 ms reads `1.2 s`. Contributed by Shyam-Makwana. (#112)
- Fixed: a command that ends a subshell was read with the closing bracket on its name, so `(cd sub; ls)` lit Shell where `cd sub && ls` lights Files, and `(ls)` got the label `ls)`. Contributed by Shyam-Makwana. (#113)
- README: the options are in four groups, how it looks, what it shows, memory and servers, in a terminal only; the Install section says what to do about the notices on a Team or Enterprise login; two more examples of `claude plugin configure`, with every value written as a string. (#106)
- The pull request form asks whose code it is: that the author wrote the change, and where anything copied comes from and under which licence. (#104)
- Inside: the check runs a second time on the newest Claude Code, on every pull request and once a day, and blocks no merge; two tests that ran close to the test kit's five seconds have the time they take. (#107, #108)

## 0.10.0 (2026-11-18)

- New option `serverStations`: put an MCP server's tools on a station of your choice, each as `server=station`, with `files`, `shell`, `web`, `browser`, `agents`, `skills` or `you`. The row still reads `server: tool`. Memory keeps `memoryServers`, which wins if a server is in both. Contributed by arandevcode. (#55, #86)
- New option `paneBackground`: `transparent` takes the pane's grey away in a terminal, so the terminal shows behind the map and the rows alike, wallpaper and blur included; a colour as `#rrggbb` paints the pane in it. `theme`, Claude Code's own, stays the default. Contributed by Wesley-Gomes. (#87, #88)
- New option `guardedHooks`, on by default. On a Team or Enterprise login an organisation's guard keeps mods away from five events, and the transcript got notices like `lot-map: its classic.PreToolUse hook was skipped`. Turned off, the mod adds no hook on them. The map then loses the Hooks station, the records a hook adds, the row of a typed slash command and the mark of a compaction; a call a hook refused still gets its `✕`, as a failed call and not as a blocked one. Reported by arandevcode and kjbrick, tested on a Team login by whermeling. (#54, #89, #91)
- Fixed: in the desktop app a session can start before a surface is attached, and the transcript then got a `no-surface` line from the mod. The pane is opened at the start only where a surface is attached, and again when one joins. Described by kjbrick. (#54, #90)
- Fixed: a `|`, `;` or `&&` inside quotes parted a shell command in two, so `grep -E "ssh|curl" log.txt` lit Shell and `git commit -m "fix: retry; curl fallback"` lit Network. A line is now read in one pass that knows which quotes it is in. With it, a single `&` ends a command, a comment is no command, a backslash at a line's end joins two lines, and a command inside `$(…)` or backticks counts inside double quotes and not inside single ones. (#92)
- Shell commands land on the right station more often: a here-document handed to a shell (`bash <<EOF`) is read as that shell's script, and `docker exec`, `docker run` and the same two under `docker compose` are read by the command they run in the container. (#94)
- The ids of calls a hook refused, which the mod remembers until each call comes by, are held to the newest 64. (#93)
- README: the list of what the braille map leaves out has one more line, a subagent's call leaving from the Agents station; in braille every call flies from the centre. (#95)
- Inside: a test holds an inventory of everything the first drawing shows against the braille map, and the check holds the README's list to it; `hooks/register.tsx` keeps the hooks, and the board, the pane and the sums of `contextCost` have files of their own. (#95, #96)

## 0.9.0 (2026-11-16)

- Fixed: in iTerm2, `terminalView: picture` made iTerm2's memory grow without limit. iTerm2 keeps every picture it is sent until its tab is closed: measured in iTerm2 3.7.7, a moving map took about 2 MB a frame, 17 GB in five minutes. In iTerm2 the picture is now off and a line above the rows says so; `braille` gives the map there. kitty, Ghostty and other terminals keep the picture. For this the mod reads `TERM_PROGRAM` and `LC_TERMINAL`, which PRIVACY.md names. Reported by castigator. (#81, #82)
- New option `contextCost`, off by default: a call's row says about how many tokens the context grew by with its answer, after its time (`85 ms +42k`), and the desktop map adds each station's sum to its count (`9 · 180k`). An estimate, shown one step late: the growth also holds the model's own words and what hooks added. Two or three calls in one step share it evenly, marked `~`; more get no figure. Contributed by Obsessi0n. (#80, #83)
- A running row has a colour of its own, the theme's blue. It was in Claude's colour, which on a light theme stands next to the colour of a failed row, and a running call read as a failed one. The demo and the pictures in `docs/` show it. (#77)
- SECURITY.md and README: two sentences set right. Contributed by lunar-me. (#78, #79)

## 0.8.0 (2026-11-14)

- New terminal view, `terminalView: braille`: the map above the rows in braille dots and letters, for a terminal that shows no pictures, such as Windows Terminal. With `background` on `solid` it stands on its own ground and reads in any pane. `text` stays the default. Contributed by Obsessi0n. (#52, #68)
- New option `subagentNames`, off by default: a subagent's model step says which subagent it is, by the few words it was started with, up to 40 characters. With it on, the calls of two subagents never share a folded row. (#70, #71)
- Fixed: a call still running, such as a background task, was pushed out of the list by sixteen newer rows while its station still beat on the map. It stays as the last row until it ends. Such rows take half the list at most; with more still running, the last is marked `+22` for the rest. (#72)
- Shell commands land on the right station more often. A command inside `for … do`, `if … then`, `while`, `!` or `{ … }`, a line handed to `bash -c` or `eval`, and a command behind `watch` are read as the command itself. The text of a here-document is no longer read as commands, so a file written through one shows as Files. (#73)
- More commands are known to reach the network: `kubectl`, `aws`, `gcloud`, `az`, `nmap`, HTTPie, `pip3.12`, bare `yarn`, `bun i`, and subcommands of `svn`, `hg`, `terraform`, `helm`, `deno`, `openssl` and `git`. (#73)
- A command line is read up to its first 8,000 characters. Naming a call whose command is a 19,000-character script takes 0.4 ms where it took 15. (#73)
- More built-in tools that lit Shell land by what they are for: an MCP server's resources on Memory or Network by their server, code intelligence on Files, what agents hand to each other on Agents, designs and published plugins on Network. Each label is the tool's name. Contributed by anand-krishanu. (#66)
- PRINCIPLES.md: the terminal picture's frame has a cost test and its figures. A frame takes 19 to 20 ms with the map at work, which the page names as the one cost that is not small. (#74)
- README: its opening says what local means: the mod sends nothing anywhere, and it is handed each call whole and takes names from it. PRIVACY.md says what `subagentNames` adds. (#74, #71)

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
