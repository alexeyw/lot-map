# How the options look

The options that change what you see, each with a picture of its values. What every option means, and how to set one, is in the README under [Options](../README.md#options).

The pictures of the map are painted by the mod's own code from one made-up session: `node scripts/option-pictures.mjs` makes them again. The pictures of a terminal are shots of a kitty window.

## The map

| Option | As it comes | Changed |
| --- | --- | --- |
| `theme` | `dark`<br><img src="options/default.png" width="300" alt="The map in its dark colours"> | `light`<br><img src="options/theme-light.png" width="300" alt="The map in its light colours"> |
| `background` | `solid`<br><img src="options/default.png" width="300" alt="The map on its own dark background"> | `transparent`, here over a blue surface<br><img src="options/background-transparent.png" width="300" alt="The map without a background of its own, a blue surface showing through"> |
| `colors` | none<br><img src="options/default.png" width="300" alt="The map in the colours it comes with"> | `accent=#7fb4ff,active=#b8d6ff,text=#e6edf7`<br><img src="options/colors-own.png" width="300" alt="The map with a blue accent in place of the amber one"> |
| `layout` | `you-top`<br><img src="options/default.png" width="300" alt="The map with You at the top of the ring"> | `you-bottom`<br><img src="options/layout-you-bottom.png" width="300" alt="The map turned half a turn: You at the bottom, the network at the top"> |
| `coreName` | `CLAUDE`<br><img src="options/default.png" width="300" alt="The circle in the middle says CLAUDE"> | `HOME`<br><img src="options/core-name-own.png" width="300" alt="The circle in the middle says HOME"> |
| `language` | `en`<br><img src="options/default.png" width="300" alt="The stations named in English"> | `ru`<br><img src="options/language-ru.png" width="300" alt="The stations named in Russian"> |

`theme` comes as `auto`: dark on a dark surface and light on a light one. `language` also takes `es`, `fr`, `de`, `it` and `pt`.

## Motion

| `motion: full` | `motion: reduced` |
| --- | --- |
| <img src="options/motion-full.gif" width="340" alt="A made-up session on the map with full motion"> | <img src="options/motion-reduced.gif" width="340" alt="The same session with reduced motion"> |

The same session twice. With `reduced` nothing flies, spreads or spins: a call still lights its station and its spoke, and those only fade.

## In a terminal

`terminalView` says what stands above the rows.

| `text` | `picture` | `braille` |
| --- | --- | --- |
| <img src="options/terminal-view-text.png" width="270" alt="The pane in a terminal with the rows alone"> | <img src="options/terminal-view-picture.png" width="270" alt="The pane in a terminal with the map as a picture above the rows"> | <img src="options/terminal-view-braille.png" width="270" alt="The pane in a terminal with the map in braille dots above the rows"> |

`paneBackground` says what the pane itself is painted with. The terminal in these shots is black.

| `theme` | `transparent` | `#16263d` |
| --- | --- | --- |
| <img src="options/terminal-view-picture.png" width="270" alt="The pane in Claude Code's own grey"> | <img src="options/pane-background-transparent.png" width="270" alt="The pane with no colour of its own: the black terminal shows behind the map and the rows"> | <img src="options/pane-background-colour.png" width="270" alt="The pane painted dark blue"> |

## Without a picture here

- `textSize` (`caption`, `footnote`, `body`): the size of the rows under the map in the desktop app. A terminal has one size.
- `logRows` (`16`, `fill`): how many rows the list shows in the desktop app's docked pane.
- `openAtStart` (`true`, `false`): whether the pane opens by itself when a session starts.
- `cellShape`: how tall a terminal's cells are, which sizes the picture's box.
