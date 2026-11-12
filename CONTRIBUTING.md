# Contributing

Thanks for wanting to help. lot-map is small and kept by one person in his own time, so a few rules keep it easy to review.

## Before you write code

- **A bug or a small fix:** open a pull request straight away.
- **Anything larger** (a new option, a new station, a new way to draw the map, more than about 200 lines): open an issue first and say what you have in mind. Two people have already built the same feature in parallel; an issue saves that.
- **A change to how the map looks:** attach a picture. How the map looks is the maintainer's call, and a picture is what he decides from.
- **A security problem:** not in an issue. See [SECURITY.md](SECURITY.md).

## What the mod must stay

These are not style. A change that breaks one of them will not be merged.

- **It watches and changes nothing.** Every hook passes the event on as it came and returns what came back as it was: no input, result, prompt, context or permission decision is touched.
- **A label holds a name, never content.** No command line, query, file text, path beyond its last two parts, or address beyond its host. The list is in the [README](README.md#what-it-shows-and-what-it-keeps) and in [PRIVACY.md](PRIVACY.md); if your change makes the mod read or keep something new, say so in the pull request.
- **No network, no files, no processes.** The mod uses the engine's calls and nothing else.
- **A fault on the map never reaches the work.** Engine calls go through `quietly`; a broken board must not stop a tool call or a turn.
- **What a user has today stays as it is.** A new option's default keeps the present behaviour.

## Running it

You need Claude Code. The tests are known to pass on 2.1.321, the version CI uses.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Neither needs an account. To see your change live, point Claude Code at your checkout:

```bash
claude --plugin-dir .
```

It takes the place of an installed lot-map for that session and starts with the default options. Afterwards you may find the engine's types in `.claude-plugin/types/` and a `tsconfig.json` beside them, for your editor; both are ignored by git.

CI runs the first two on every pull request. On your first one a maintainer has to approve the run, so it may wait a little.

## A pull request

- **Open it against `next`, not `main`.** Installs follow `main`, so it changes only at a release; `next` collects what the next release will hold. Branch from `next` too.
- **One thing per pull request.** A fix and a feature are two.
- **A test for what you changed.** Tests here state behaviour in their names (`a password never reaches a label…`); add yours the same way, and for a bug, one that fails without the fix.
- **Say what you checked and what you did not:** the commands, the Claude Code version, the system, and whether you saw it in the desktop app or a terminal.
- **Leave the version, `CHANGELOG.md` and the version line of `PRIVACY.md` alone.** They are written at release, and the changelog credits you by your GitHub login.
- **Code written with an AI assistant is welcome**; most of this repository is. You answer for it all the same: read the diff and run the tests before you send it.

## A new language

Like [#20](https://github.com/alexeyw/lot-map/pull/20) and [#31](https://github.com/alexeyw/lot-map/pull/31):

1. one more table in `hooks/text.ts`, with every key the English one has;
2. one more value of `language` in `.claude-plugin/plugin.json`;
3. the `language` row of the README's options;
4. the two language tests in `hooks/lot-map.test.tsx`: the `LANGUAGES` list and the pane's row.

Please translate a language you speak.

## Where things are

| File | What is in it |
| --- | --- |
| `hooks/map.ts` | what a call is called and where it lands (`classify`), colours, the drawing, the rows |
| `hooks/register.tsx` | the hooks and the pane |
| `hooks/text.ts` | the words, one table per language |
| `hooks/lot-map.test.tsx` | the tests |
| `types/index.d.ts` | the board's shape |
| `.claude-plugin/plugin.json` | the manifest and the options |

## Licence

By contributing you agree that your work is published under the repository's [licence](LICENSE).
