# Security

## Reporting a vulnerability

Please report it privately, not in a public issue: open the repository's [Security tab](https://github.com/alexeyw/lot-map/security) and choose **Report a vulnerability**. GitHub keeps the report between you and the maintainer until a fix is out.

Say what you saw, on which version of lot-map and of Claude Code, and how to see it again. A session you can describe in a few steps is worth more than a long explanation.

I maintain this alone and in my own time. I read every report and answer as soon as I can; a fix goes out as a new version, with a line in the [changelog](CHANGELOG.md) and credit to you unless you ask otherwise.

## Which versions

Only the latest version, the one on the `main` branch, gets fixes. To get it, see [Updating](README.md#updating).

## What counts

The mod is meant to watch and to change nothing, so any of these is a vulnerability:

- a label, row or stored value that holds content and not a name: a command line, a query, a file's text, a secret, more of a hook's words than the options allow;
- a hook of the mod's that changes a tool call, its result, a prompt, the context, or a permission decision;
- a network request, a file read or a process started by the mod;
- text from a tool call or a hook that gets drawn as something other than plain text.

What the mod is handed and what it keeps is described in [PRIVACY.md](PRIVACY.md).

## What does not

A wrong label, a station that does not light up, or a drawing fault is a bug: open an ordinary [issue](https://github.com/alexeyw/lot-map/issues). A problem in Claude Code itself, in its mods API or in another plugin belongs to its own maintainers.
