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

The development server pre-bundles the modules that only the slicing Web Worker and the lazily
loaded model readers use (`optimizeDeps.include` in `vite.config.ts`). Without that, Vite would
discover them on first use and reload the page, interrupting the first upload or estimate.

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

- Model search bar at the top of every page (sticky header): searches Thingiverse, Printables
  and MakerWorld through the backend's `GET /model-search` and opens `/search?q=…`. All
  results share one card: thumbnail, site badge, title, author, plain-text description and
  a link that opens the original posting on its site in a new tab. A line above the results
  shows each site's result count, or that it is unavailable/not configured, with a link to
  the same search on that site. The count is the site's total number of matches (with the
  locale's digit grouping), or the loaded count with "+" when a site reports no total.
  The license note ("check each model's license") is shown above the results. **Load more
  results** below the grid appends the next page from every site that has more (the backend's
  `nextCursor`) and disappears at the end; a failed load keeps the loaded results and can be
  retried, and a site that fails midway is marked "couldn't load more". Thumbnails load from
  the sites' image servers without a referrer and fall back to a placeholder.
- Ordering a found project happens in two steps.
  1. A sticky **Order a project** box on the right of the results (below them on narrow
     screens) previews the last clicked result, or a pasted link to a model page on any of the
     three sites (`GET /model-search/project`): thumbnail, title, author, license, number of
     models and a link to the original page. After an order is sent, its confirmation is shown
     there until another project is clicked, which replaces it.
  2. **Order this project…** opens a dialog with every model of the project (all selected by
     default, with select all/none) and print settings: quantity, scale and one or more
     material + color rows per model (add/remove rows for multi-color or multi-material
     prints; colors are free text with common suggestions). **Use one selection for all
     models** (on by default) shows one settings editor for every selected model; turning it
     off gives each model its own editor, starting from the shared selection. Notes and the
     customer's contact/delivery details complete the order (`POST /orders` with `source: "project"`). Sites
     that list no models get one whole-project item. The dialog closes with Escape, the Close
     button or a click outside it, and returns focus to the order button.

- `/print-on-demand` (**Print on Demand** in the header; the former `/ready-to-print` address
  redirects): projects the shop has reviewed, shown
  with the same cards as search results plus their printing price, which the server calculates
  from the product's print time and filament with the shop's current rates
  (`GET /project-products`). The box on the right previews the last clicked one with its price;
  **Order for …** opens a dialog listing the models (quantity and scale fixed) with a material
  and color for each filament, a number of sets with a live total (handling fee once + sets × set
  price), notes and contact/delivery details (`POST /orders` with `source: "printOnDemand"`). Colors can
  be changed freely at the same price. Changing a material marks it, replaces the total with
  "Quote needed" and sends the order as a request for a quote ("Use the offered materials"
  restores them, keeping the colors). The confirmation says whether the price is fixed or a
  quote follows, and stays until another project is clicked. Both order dialogs share one modal component (portal, Escape/backdrop to close,
  focus on open and back to the order button on close).

  Products the shop has **sliced** (`printOptions` in the API) show, instead of material choices,
  a **Print quality** choice for every plate of the shop's print file (name, nozzle, layer height,
  material and one set's price with it at the chosen size) and a **Size** slider within the
  shop's range (or the fixed size). The total comes from the shop
  (`POST /api/project-products/:id/quote`, asked again a moment after every change); the
  variants decide the materials, colors stay free, and the order carries the chosen variants and
  scale. The models' scales shown follow the chosen size.

  The chosen project, models, settings and notes are kept in `printforge.projectOrder` in
  localStorage across searches and reloads (drafts from the previous version are upgraded);
  contact details last only for the visit. No payment is taken: the shop reviews the order
  and quotes by email.
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
- `/print-your-model` (**Print your model** in the navigation): an order of the customer's own
  models, in two steps.

  **1. Upload files**: drop or browse up to 10 STL/3MF files (50 MB each). Each file is read
  in the browser first: other types, empty, oversized, duplicate, unreadable files and files
  whose contents contradict their extension are listed as not added. Accepted files show a
  rendered miniature, size, dimensions and volume (a multi-plate slicer project is measured and
  shown as the whole set of its plates), a warning when larger than the 270 mm build volume,
  and a copies field (1–20).

  Each model then gets print options from the shop's offer (`/api/print-settings`; if it can't
  load, a retry is offered and the summary is blocked): **one slicing profile** — a
  **Printer**, a **Print profile** (process) and a **Filament profile** made for that printer,
  from the presets the shop offers (the 0.4 mm printer with its default presets is preselected;
  another printer keeps the presets that suit it, otherwise takes its defaults) — **Supports**
  and a **Scale** (1–1000%, with the printed size and a warning when it exceeds the 270 mm build
  volume or a side gets thinner than 5 mm). For each color of the model the customer chooses a
  **filament type** (name and description) and a **color** from those the shop stocks for it.
  Single-color files have one filament choice; multi-color 3MF files list every color part with
  its color in the file, preselected with the nearest stocked color. Changing the filament keeps
  the color when offered, otherwise picks the most similar one. The miniature is redrawn in the
  chosen colors (files over 20 MB keep the first miniature).

  **Estimated price**: the browser slices every model with its profile and scale, one model at a
  time in a Web Worker (the engine of `src/slicer/engine`, the same as the administration's),
  every plate of a slicer project added up, and sends the print time and grams per color part to
  `POST /api/uploads/estimate`, which prices them with the shop's hourly rate, the chosen
  filaments' prices per kilogram and the handling fee. While a model is sliced its row shows a
  progress bar ("Slicing for the estimate… N%"). The order has **one** price, shown at the
  bottom of each step (above **Continue to summary**, and above **Confirm order**): a progress
  bar for the whole estimate while slicing, then the estimated total of all copies with the
  handling fee included. Customers never see print times, weights or rates. A changed profile or scale
  slices the model again; another filament type only reprices it. If a model can't be sliced
  in the browser, it can still be sent — the shop prices it. The order carries the profile and
  the slicing result; the shop slices the file again with exactly that profile before quoting
  the final price. The engine, presets and calibration in `src/slicer/engine/` are generated by
  `npm run sync-frontend` in `../slicer` (the storefront's own copy); `src/slicer/client.ts`,
  `protocol.ts`, `runSlice.ts`, `slicer.worker.ts` and `profileCatalog.ts` are the same Web
  Worker kit as the administration's. The engine runs in a Web Worker started by the first
  estimate; the preset list (`profiles.json`, ~85 kB) is part of the app bundle.

  Clicking a model's miniature or description (in either step) opens an interactive 3D preview
  in the chosen colors, with its details, options and estimate; it reads the file on the
  customer's device, nothing is uploaded before confirming. Escape, **Close** or clicking
  outside closes it. Optional printing instructions apply to the whole order.

  **2. Summary and confirmation**: the files with their profiles, scales, filaments, copies and
  estimates, total prints, the instructions and the estimated total price with handling (the
  shop confirms the final price), plus contact and delivery details (the same fields as checkout). **Confirm order**
  uploads the files one by one with progress (`POST /api/uploads`), then places the order
  (`POST /api/orders` with `source: "upload"`); nothing is paid. Files
  already accepted are not uploaded again when retrying after an error, and uploads the server
  no longer accepts (after 23 hours) are re-sent automatically. If the shop withdrew a chosen
  option meanwhile, the error is shown and the current options are reloaded. The confirmation
  shows the `CP-…` order number. Chosen files, options, copies, instructions and contact
  details stay while visiting other pages of the shop (files can't be kept in browser storage,
  so a reload starts over). three.js loads only once a file is picked.
- `/cart`: persistent cart and checkout. The backend recalculates the current prices.
  Items show their texture (shop texture name or custom picture). If the shop withdraws a
  chosen texture, the cart says so and links back to the product; checkout rejects it.
  There is no online payment; successful checkout records an order for shop follow-up
  (`POST /api/orders` with `source: "catalog"`).

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
and proportional scale cover the whole set. Dynamic printing prices are for the set;
premium filament is charged once per filament, and engraving/colored engraving/texture
fees once per set. Cart details retain each plate's appearance.

## Dynamic catalog pricing

Catalog prices use the current shop-wide Pricing rates. Estimated filament weight is model
volume × 1.3 g/cm³ × 30%, and estimated print time is weight ÷ 20 g/hour. Both scale with
the volume ratio when dimensions change. The item price is estimated print time × hourly
rate + weight / 1000 × the material's per-kilogram rate, plus existing color/engraving/texture
surcharges. Recognized materials are PLA (including PLA+), PETG, ABS, ASA, TPU and resin;
unrecognized product material names use PLA.

Products the shop has sliced offer a **Print quality** choice in each plate's panel (or in the
configurator of a model without plates): the shop's print variants — name, nozzle, layer
height and material — each with its price at the chosen size. The print price is then the sum
of the chosen variants' prices at the chosen scale instead of the volume estimate: the API
publishes each variant's price at the original size (`catalogPricing.variantPrices`) and at the
smallest and largest scale the shop sliced (`catalogPricing.variantScalePrices`); sizes in
between are interpolated exactly as the server does at checkout. The price note names the
variants and the scale. Choices are kept in the product draft and cart, shown in cart details,
and fall back to the shop's default when a variant is withdrawn.

**Sizes.** The size picker (quick sizes Min … Max, slider and millimetre fields) appears only for
products the shop made scalable, limited to the shop's smallest and largest scale; sizes outside
it show "Choose a size from 60% to 140% of the original." and can't be added to the cart. Other
products show their fixed size ("printed at the original size") and are always ordered at it,
also from older drafts and carts. Products saved before the setting keep the printer's limits.

**Catalog.** The shop page is titled **Our design 3D prints** and every product card shows the
price of the product as it first opens: original size, default print variants and first color
(before handling).

Product prices exclude the handling fee, which is shown separately and added once to the
whole cart/order, regardless of quantities or number of lines. Catalog reads carry current
API-derived rates; visible pages refresh every 15 seconds and on window focus, updating
product prices and existing cart entries without resetting customer drafts or rewriting
legacy cart storage. Failed refreshes show the load error/retry UI. Checkout recalculates
from current server rates and explains any last-moment price change. Placed orders retain
their snapshots, including their handling fee. Legacy product `basePrice`/`fixedFee` values
are used only for older responses without dynamic rates.

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
