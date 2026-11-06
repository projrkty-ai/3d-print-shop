# PrintForge customer storefront

Independent React/TypeScript/Vite application. No admin screens, authentication state
or administrative API operations are included. All types, validation, pricing display,
3D helpers and tests are local copies, not imports from another application.

```bash
npm ci
cp .env.example .env
npm run dev
```

Node 22+ is required. Development runs on port **5173**. `npm test` runs this application's
tests; `npm run build` type-checks and produces `dist/`; `npm run preview` uses port 4173.
The backend must be running, but no backend files are required to install, test or build.

## Configuration and deployment

- `VITE_API_URL`: public API base URL including `/api`; default `/api`.
- `API_PROXY_TARGET`: development/preview proxy target, default `http://localhost:3001`.
- `VITE_APP_LANGUAGE`: static interface language, `pl` (Polish) or `en` (English).
  The supplied `.env` and example select Polish; an unset value selects English.
  Unknown or empty values fail explicitly. Restart development or rebuild after changes.
  This setting also controls document language/title, number formatting and plural forms.
  Currency remains USD; product names, descriptions, color names and customer content
  are not machine-translated or rewritten.

Translations belong to this application only: `src/i18n/pl.json` maps typed English
source messages to Polish. UI and validation use `t()` from `src/i18n`; interpolated
values stay separate from translated text. Count messages use locale-aware plural rules.
Add every new static message and preserve its named placeholders; adding another language
requires its catalog and an explicit entry in the language resolver. Tests pin English
independently of `.env`, with dedicated Polish catalog/UI regressions.

For separate hosting, set `VITE_API_URL=https://api.example.com/api` before building,
configure the backend to allow the shop origin, and host `dist/` with SPA fallback.
For a same-origin reverse proxy, route `/api` and `/models` to the backend. Bundled and
uploaded model/image paths resolve to the API host; absolute URLs and image data URLs
remain unchanged. Never configure an admin secret in this application.

## Customer features

- `/`: catalog with actual STL/3MF thumbnails. Product photos take precedence.
  Thumbnails are lazy-loaded, cached and generated with one short-lived off-screen renderer.
- `/product/:id`: live model previews, proportional size controls (5–270 mm per side),
  filament selection and painted-part replacements, text/font/text color and picture texture.
  On desktop, the description and media carousel occupy the left column; every preview,
  appearance/size control and order action occupies the right. Mobile stacks description
  before configuration. The product photo, carousel-only gallery and inline images/videos
  appear in a deduplicated carousel above the description; inline media also retain their
  original positions. Videos use controls without autoplay (YouTube, Vimeo or MP4/WebM).
  The customer carousel uses left/right overlay arrows with full-height edge hit areas
  and a small overlaid slide count, not a media list below. Slides animate in the selected
  direction; arrows fade on hover/keyboard focus and remain visible on touch devices.
  Reduced-motion preferences shorten slide animations and disable arrow fades. Video
  players stay between the navigation areas so their native controls remain usable;
  leaving a video unmounts it immediately instead of keeping hidden playback running.
- 3D lettering: when the shop placed raised 3D text on the model, the product page shows
  its suggested text and size. Customers edit the text (clearing it prints none) or scale
  the size between 50% and 200%; the preview, cart thumbnail and order render the raised
  letters on the model in its print color. The bundled 3D font (a DejaVu Sans subset, see
  `src/fonts/lettering-font-license.txt`) covers Latin letters including European accents.
- Picture texture: customers choose **No texture**, one of the shop's textures (thumbnail
  tiles defined by the administrator) or **Your picture** (a browser-downscaled upload),
  when the product allows uploads. The 3D preview shows the chosen texture, and the price
  summary names the chosen shop textures. Switching to a shop texture and back restores
  the last uploaded picture during the visit. Products without shop textures show the
  original upload field only.
- `/cart`: persistent cart and checkout. The backend recalculates the current prices.
  Items show their texture (shop texture name or custom picture). If the shop withdraws a
  chosen texture, the cart says so and links back to the product; checkout rejects it.
  There is no online payment; successful checkout records an order for shop follow-up.

Browser drafts use `printforge.productDraft:<id>` in localStorage. Dimensions/shared
scale, quantity and every plate's colors, lettering and uploaded texture survive
navigation and reload, even after adding to the cart. A selected shop texture is saved by
id (`textureId`); drafts from before the texture library remain valid. Current product
metadata repairs obsolete choices. Invalid text or unfinished dimensions stay editable
and block ordering. Storage failures show a warning. Cart storage remains
`printforge.cart`. Drafts and cart are local to the browser origin, so retain the previous
shop origin when deploying this separation if customers should retain their existing
browser state.

Rich descriptions use `descriptionFormat: "html"` and are sanitized before rendering.
Older descriptions remain escaped plain text, including literal angle brackets. The
storefront never trusts arbitrary iframe HTML: recognized video URLs create allowlisted
embeds. Description image paths resolve to the configured API origin for separate hosting.

## 3MF and multi-plate sets

Standard 3MF materials and Bambu Studio/OrcaSlicer filament palettes, extruder assignments
and painted-triangle subdivision are supported. Up to eight editable colors are offered;
malformed painting produces a visible error. PrusaSlicer-specific palettes and multiple
beds are not supported.

Each administrator-selected plate has its own preview and appearance controls. Dimensions
and proportional scale cover the whole set. The base price/fixed fee are for the set;
premium filament is charged once per filament, and engraving/colored engraving/texture
fees once per set. Cart details retain each plate's appearance.

Administrator-owned text anchors/alignment and texture centers/sizes apply automatically
to these previews. Without settings, text is centered and the picture appears once on the
front, keeping its proportions within 30% of the circumference × 60% of the height; it never
wraps around the whole model. Pictures keep their own colors, laid over the filament with
a relief; engraving is drawn on top. Caps, inner walls (e.g. inside a vase) and the back
of open surfaces stay undecorated. When a plate holds several objects, each one shows the
plate's text and picture on its own front. Customers cannot override the stored placement through
checkout.

Cart items show a rendered picture of the configured print — the real model in the chosen
colors with its engraving and texture, each plate of a set side by side at relative size —
made off-screen with one shared WebGL context and cached. It uses the item's own snapshot
(colors, text, placement, texture) and the product's 3D model; while rendering, without
WebGL or when the product is no longer available, the color swatch is shown instead.

The local `fixtures/models/` directory is used only by tests and is not the runtime model
source. Production model assets belong to the backend.
