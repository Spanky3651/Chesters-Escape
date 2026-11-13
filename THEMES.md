# Adding a new theme

A theme is the look and wording of a game: title, story line, events, cards, colors and pictures. The board (its spaces and routes) is separate and can come from the board designer.

Run `node tests/engine.test.js` when you think you're done. It ends with a theme check (`tests/themes.test.js`) that names anything missing below, so nothing quietly falls back to another theme's words or the graveyard Chester.

## Checklist

Copy the closest existing theme and change it. Chester themes have no `family` (GenX); Taco themes have `family: 'taco'` (Beaters).

1. **Theme entry** in `docs/js/content.js`, under `THEMES`:
   - `id` (same as its key), `name` (shown in the picker), `title`, `tagline` (the story line), `goal` (where Chester or Taco is headed)
   - `font` (its first font must be in the Google Fonts link in `docs/index.html`)
   - `palette.accent` (also the color bar on Discord posts)
   - `card` names (back, treasure, trick, task, fate) and `words` (card-space label, start, routes, escaped, results)
   - `routes.longer` and `routes.riskier` blurbs (`{n}` becomes the space count)
   - `kinds`: every event, with a title and an icon. Same list as the other themes in its family.
   - Optional: `look` (reuse another theme's look), `hat`, `hero`, `deck` (picture cards), `mapSet`, `art`, `artHero`, `shot`
2. **Card wording** in `WORDS` in `content.js` (20 cards), unless the theme has its own `deck`.
3. **Discord picture**: `thumb` (a square image in `docs/img/themes/`), or `artHero` for Taco themes. Without one, posts show the graveyard Chester.
4. **Board look** in `docs/js/render.js`, `LOOKS.<look>` (sky, fence, decorations, tile colors). Skip if it reuses another look.
5. **Colors** in `docs/css/game.css`: a `body[data-theme="<look>"]` block (page colors and the title color). Skip if it reuses another look.
6. **Taco themes with `artHero`**: a notification icon at `docs/img/push/<id>.png`.
7. **Map set** (Taco games): add it to `MAP_SETS` and set `mapSet`.

## Things that follow on their own

- **Game name:** a game on a designer board uses the board's name (Host tools shows it everywhere, including Discord).
- **AccSaber mode** wording, rules, buttons and posts.
- **Picture cards** from a theme `deck` and board art from the designer board file.

## Before players see it

- Look at it in the demo (open `docs/index.html` from your PC), Host tools theme picker, and How to play.
- Send a Discord test post from Host tools, Alerts, and check the picture and title.
- Bump `?v=` and `data-updated` as usual, then push.
