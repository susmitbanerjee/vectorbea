# Self-hosted font licences

All three families are redistributable and may be self-hosted for commercial use. Files here are
subset to **latin + latin-ext**.

| Family | Foundry / source | Licence | Files |
|---|---|---|---|
| Cabinet Grotesk | Indian Type Foundry, via [Fontshare](https://www.fontshare.com/fonts/cabinet-grotesk) | ITF Free Font Licence | `CabinetGrotesk-{Medium,Bold,Extrabold}.woff2` |
| Switzer | Indian Type Foundry, via [Fontshare](https://www.fontshare.com/fonts/switzer) | ITF Free Font Licence | `Switzer-{Regular,Medium,Semibold,Bold}.woff2` |
| JetBrains Mono | JetBrains, via [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono) | SIL Open Font Licence 1.1 | `JetBrainsMono-{latin,latin-ext}.woff2` (variable, 100–800) |

Both licences permit embedding in websites and applications. Neither permits selling the fonts
themselves, and the ITF licence requires that the fonts not be redistributed as a standalone
product — self-hosting as part of this application is fine.

## JetBrains Mono is variable

Google serves it as a single variable file per subset. The per-weight downloads for 400, 500 and 700
are byte-identical, so it is declared once with a `100 800` range — three static declarations would
have shipped the same file three times and left the browser synthesising faux bold.

## Weight mapping

Cabinet Grotesk has no 600 cut. `CabinetGrotesk-Medium` (the family's 500) is declared as weight 600
in `../fonts.ts`, because design §4.1 asks for Cabinet 600 at `display-md`. Requesting 600 therefore
returns a real drawn cut rather than a browser-synthesised one.

## Replacing the stack

Drop replacement `.woff2` files into this directory and edit the `src` arrays in `../fonts.ts`.
That is the only file that names a typeface.
