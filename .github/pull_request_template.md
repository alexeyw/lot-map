<!-- Read CONTRIBUTING.md first. One thing per pull request, opened against `next`, not `main`. -->

## What and why

<!-- What changes for someone using the map, and what was wrong or missing before. Link the issue if there is one. -->

## Checked

<!-- Commands, the Claude Code version, the system, and where you saw it: desktop app, terminal. Say also what you did not check. -->

- [ ] `claude plugin validate .`
- [ ] `claude plugin test .`
- [ ] A test covers the change; for a bug, it fails without the fix

## It keeps to what the mod is

- [ ] No hook changes an input, a result, a prompt, the context or a permission decision
- [ ] No label holds content: no command line, query, file text or full path
- [ ] No network request, file read or process
- [ ] A new option's default keeps today's behaviour
- [ ] The version, `CHANGELOG.md` and the version line of `PRIVACY.md` are untouched
- [ ] For a change to how the map looks: a picture is attached

<!-- If the mod now reads or keeps something it did not before, say what. -->
