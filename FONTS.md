# The picture's letters

The map's picture in a terminal (`terminalView` set to `picture`) writes its words with letters from five bitmap fonts: the X.Org misc-fixed fonts in the versions Markus Kuhn drew for Unicode, his ucs-fonts. `hooks/font.ts` holds the 429 letters the map can write from each of them, taken as they are. The fonts themselves are not in the repository.

## Where they come from

X.Org's [font-misc-misc](https://gitlab.freedesktop.org/xorg/font/misc-misc), tag `font-misc-misc-1.1.3` (commit `c4e2af05583764fae3d0b2aa20d5c93b031cbcbf`):

| File | Font | Its ucs-fonts revision | SHA-256 |
| --- | --- | --- | --- |
| `6x13.bdf` | `-Misc-Fixed-Medium-R-SemiCondensed--13-120-75-75-C-60-ISO10646-1` | 1.115 | `c68c55ca8effcdc2714fffa9c8e07df290411867b00b547eeae952f7473efc9b` |
| `7x14.bdf` | `-Misc-Fixed-Medium-R-Normal--14-130-75-75-C-70-ISO10646-1` | 1.47 | `b7ab88773ed6a9004039c001f7687e14934cfa73cb0251439b51b28134a0887b` |
| `9x18.bdf` | `-Misc-Fixed-Medium-R-Normal--18-120-100-100-C-90-ISO10646-1` | 1.53 | `35771bf96948cbb10a9c8de08ae2a064710ee61c3094bbeb170e2aa369be060d` |
| `10x20.bdf` | `-Misc-Fixed-Medium-R-Normal--20-200-75-75-C-100-ISO10646-1` | 1.91 | `3480bcb4a20b67fe7fb88e01f179caf781954e642c3a7a77f325de1a435c1208` |
| `7x14B.bdf` | `-Misc-Fixed-Bold-R-Normal--14-130-75-75-C-70-ISO10646-1` | 1.25 | `126ebdceaf8a735cfbf9c6d11cf4435fcbe8942329971e628d43dc6ee50f3f5f` |

`scripts/font.mjs` makes `hooks/font.ts` from them, and makes it byte for byte as it is in the repository:

```bash
for f in 6x13 7x14 9x18 10x20 7x14B; do
  curl -fLO "https://gitlab.freedesktop.org/xorg/font/misc-misc/-/raw/font-misc-misc-1.1.3/$f.bdf"
done
node scripts/font.mjs hooks/font.ts 6x13.bdf 7x14.bdf 9x18.bdf 10x20.bdf --bold 7x14B.bdf
```

The script says that `7x14B` lacks four Cyrillic letters (Ѐ, Ѝ, ѐ, ѝ); in bold, the picture strikes the regular letter twice instead. A language that needs letters the fonts in `hooks/font.ts` do not have fails the test `the terminal picture's font has every letter the map writes, in every language`; add them to `WANTED` in the script and make the file again.

## Licence

Each of the five fonts carries this note in its `COPYRIGHT` property, and font-misc-misc's `COPYING` holds the same line and nothing else:

> Public domain font.  Share and enjoy.

The letters in `hooks/font.ts` are those fonts' own, unchanged. The rest of lot-map is under its [MIT licence](LICENSE).
