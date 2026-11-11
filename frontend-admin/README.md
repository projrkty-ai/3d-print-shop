# PrintForge administration

Independent React/TypeScript/Vite application for products and orders. No customer cart,
checkout, customer draft storage, shared package or cross-application imports are used.
This project owns its copies of types, 3D helpers, validation and pricing display.

```bash
npm ci
cp .env.example .env
npm run dev
```

Requires Node 22+. Development runs on port **5174**, redirecting `/` to `/admin`.
Sign in using the backend's admin key; it is held in sessionStorage for this browser tab.
`npm test` runs local tests. `npm run build` produces `dist/`; `npm run preview` uses 4174.

## Configuration and deployment

The development server pre-bundles the modules that only the slicing Web Worker and the lazily
loaded model readers use (`optimizeDeps.include` in `vite.config.ts`). Without that, Vite would
discover them on first use and reload the page, interrupting the first upload or slicing.

- `VITE_API_URL`: public API base URL including `/api`; default `/api`.
- `API_PROXY_TARGET`: development/preview proxy target, default `http://localhost:3001`.
- `VITE_STOREFRONT_URL`: external shop link, default `http://localhost:5173`.
- `VITE_APP_LANGUAGE`: static administrator UI language, `en` or `pl`. Unset defaults
  to `en`; any other value (including an empty value) fails explicitly. The local
  `.env` and `.env.example` select `pl`. Restart Vite after changing it, or rebuild
  for production; there is no runtime language switch.

To host separately, build with `VITE_API_URL=https://api.example.com/api`, allow the admin
origin in backend `CORS_ORIGINS`, and serve `dist/` with SPA fallback. Relative API/model
paths resolve to the backend origin; persisted product URLs remain unchanged. Never put
the backend secret in a `VITE_*` variable. The admin key is entered at sign-in, not built
into JavaScript.

### Localization boundary

All dictionaries, typed translation/interpolation helpers and locale formatting live
in this app's `src/i18n/`. English message keys are the English dictionary; `pl.ts`
contains the matching Polish translations. Translate static strings at their source
(including validation, rich-editor controls, previews and accessibility labels), never
by scanning or rewriting rendered DOM or stored rich HTML. Vite also emits the selected
document language and page title. No localization dependency or shared application code
is required.

Dates, dimensions, volumes, counts and prices use `en-US` or `pl-PL`; the existing
**USD currency is unchanged**. Number-input values, JSON field names, status/shape IDs,
font names and storage keys keep their original contracts. Product names/descriptions,
filament and plate names, media alternative text, customer content, internal notes and
historical order/price snapshots remain exactly as stored. API-provided error messages
and details are server content and are retained; administrator-generated errors are
localized. Localization never migrates or rewrites persisted data.

The Vitest configuration explicitly selects English independently of deployment `.env`.
`src/i18n/i18n.test.ts` and `src/i18n/UI.test.tsx` additionally exercise both languages,
Polish plural forms, validation/formatting, sign-in, product/editor/preview/order UI and
unchanged save payloads/HTML. Run `npm test` and `npm run build` after adding translations.

## Products and previews

Product list: search, real model thumbnails, publish toggle, duplication and deletion.
Editor: metadata/photo, scaling, sliced print variants, filament options, engraving limits/fonts/text colors and picture-texture fee. STL/3MF
uploads populate model measurements. Selected Bambu/Orca plates are sold as one set,
with separate appearances and one customer scale. Switching selected plates preserves
their layout; replacing the model clears old plate layouts.

Products with sliced print variants (below) are priced from them. Others use Pricing's hourly
and material rates with an estimate: weight is model volume × 1.3 g/cm³ × 30%; print time is
weight ÷ 20 g/hour. Handling is charged once per order, not per item or set. Product material
names map to PLA (including PLA+), PETG, ABS, ASA, TPU or resin; unrecognized names use PLA.
The product list, the Scaling card's examples and previews show print prices before handling
and customization surcharges. The legacy base price/fixed fee (from older versions) are no
longer edited and do not affect orders. Derived rates are excluded from product save payloads.
New products load current rates even when the catalog is empty.

### Scaling

The **Scaling** card replaced "Base model & pricing". It shows the original size and volume
from the model file (without a model file they are entered here) and:

- **Customers can choose the print size** — off: the product is sold at its original size only
  (the default for new products); on: customers choose any size from the **Smallest scale (%)**
  to the **Largest scale (%)** (at most 100% and at least 100%). The card shows the resulting
  sizes and the printer's limits (5–270 mm per side); the server rejects ranges beyond them.
  Loading another model file or other plates keeps the range within the new limits.
- An example price table for the smallest, original and largest size — from the default print
  variants, or from the volume estimate for products without variants.

Products saved before this setting were scalable within the printer's limits; the editor shows
that range, and saving stores it. Print variants of scalable products must be sliced at the
smallest and largest scale too (see below); a warning appears until they are.

**Save product** saves without leaving the editor and shows a confirmation. For a new
product, it opens that product's edit URL so later saves update it instead of creating
duplicates. **Save and exit** saves and returns to the product list. Both actions validate
first and stay in the editor on failure. Editing is locked while saving; already-uploaded
model files are reused when retrying metadata or saving again.

The description has a WYSIWYG editor with headings, emphasis, lists, quotes and links.
Add images by HTTP(S) link or select multiple PNG/JPEG/WebP/GIF files (maximum 10 MB
per image). Every selected image is uploaded sequentially and retained; selecting an
existing media node does not replace it when adding another. Batch failures identify
the affected filenames, keep successful images and continue with the remaining files.
Videos are links only: YouTube, Vimeo and direct MP4/WebM. Choose **Description and
carousel** to insert at the current editing position and also include it in the top
carousel, or **Carousel only** to leave the body unchanged. Alternative text labels
images and titles videos. The original product photo is also shown in the carousel.

**Product media** lists the product photo, every inline image/video occurrence and every
carousel-only entry, with image thumbnails or video links and placement labels. Edit URLs
and alternative text using **Update media**; apply or cancel these edits before saving
the product. Move media between description/carousel-only placement, select an occurrence
in the description, reorder carousel-only entries, or remove individual occurrences.
Surrounding description text is preserved. The product photo links to its existing editor
and can be removed from the list. This is a per-product manager, not a shared media library;
the storefront carousel continues to deduplicate repeated type/URL pairs.

Uploaded images are stored immediately; cancelling, removing media or deleting a product
does not delete them, since other/duplicated products may reuse their URLs. Saving is
disabled throughout the upload batch and while media-row edits are unapplied. Upload
errors are displayed. Videos cannot be uploaded.
Legacy descriptions stay plain text until edited; edited descriptions use sanitized HTML.
The local preview uses the same description-left/configuration-right layout as the shop.
Videos inside the description have a dedicated **Drag to move video** handle above the
player, plus **Move video up/down** buttons for precise or keyboard-accessible positioning.
These change the video's position among description blocks without removing surrounding
text. Editor controls are not stored in the description; only the video markup is saved.

## Print variants (slicing)

The product editor's **Print variants (slicing)** card prices a product from slicing results
instead of the volume estimate. For each included plate (a plate selector appears for sets;
files without plates are sliced as a whole):

1. Tick the **printers**, **processes** and **filaments** to offer — the bundled OrcaSlicer
   presets of the Slicer test tab. Choosing a printer preselects its default process and
   filament; every printer is combined with each chosen process and filament made for it.
2. Set **Generate supports** and optional **OrcaSlicer options** (`key = value` lines); both
   apply to every variant of that plate.
3. **Slice N variants** loads the product's model file (also an unsaved new file) and slices
   the combinations one after another in a Web Worker, with progress and **Cancel** — each at
   the original size and, for scalable products, at the smallest and largest scale of the
   Scaling card (the whole plate scaled uniformly). Finished results are kept when cancelling;
   failures are listed.

Each variant gets a customer-facing name (e.g. "0.20 mm layers, 0.4 mm nozzle, PLA"), its
nozzle, layer height and material (from the presets), and per scale the print time (0.1 min)
and filament weight. In the table (one row per scale) you can rename variants, choose which are
**offered** and the **default**, edit the print time and grams at every scale (the sliced values
stay available via **Use sliced values**), and see the price at each scale with the current
Pricing rates (time × hourly rate + grams × price per kg). Scales the range needs but that are
not sliced yet are marked; measurements of an earlier range show "(outside the range)" until the
next slicing drops them. Slicing again updates variants with the same presets and keeps their
names and offer settings; new combinations are added.

Once every included plate offers at least one variant, catalog prices come from the variants
the customer chooses: their prices at the chosen scale, interpolated between the sliced scales
(backend README, *Sliced print variants*); the Scaling card's examples then use the default
variants. Saving is refused while only some plates offer variants. Replacing the
model file clears the variants (they must be sliced again from the new file). Orders show the
chosen variant of every plate with its presets, supports and options.

## Shop textures

**Picture texture** has a price (charged once per set), **Let customers upload their own
picture** (on by default; older products keep allowing uploads) and a **Shop textures**
library. Upload several PNG/JPEG/WebP files at once (maximum 10 MB each); they are stored
immediately at full resolution in the media-file bucket, named after the file and can be
renamed, reordered or removed. As with description images, removal and cancelling keep
the stored file, because orders and other products may refer to it. Saving waits for
running uploads. The texture must be enabled with at least one shop texture or customer
uploads allowed. **Preview texture** shows any library texture, the checker sample or no
texture on the live preview; a newly uploaded texture is previewed automatically.

**3D lettering** adds raised 3D text at a fixed point of the model (or of one plate — the
plate selector is shared with the live preview). The shop sets the anchor in millimeters
from the center of the model's footprint (X right, Y toward the back — the front face is at
−depth/2 — and Z up), the facing/extrusion direction (rotation around the vertical axis and
a tilt up to lying flat, e.g. on a lid), the size, raise depth, line spacing, alignments and
the suggested text customers start from. Customers can change the text and scale the size
between 50% and 200%; there is no extra charge. The lettering prints in the model's color
and uses the bundled 3D font (a DejaVu Sans subset with Latin letters including European
accents; regenerate with `node scripts/generate-3d-font.mjs`, license in
`src/fonts/lettering-font-license.txt`). The live preview, order thumbnails and the order
viewer all draw it; orders snapshot the placement with the rest of the layout.

Text placement is inside **Engraving**; texture placement/size is inside **Picture
texture**. Plate selectors in these sections stay synchronized with the live preview.
Text uses X/Y anchors and left/center/right plus top/middle/bottom alignment. Texture
uses a center and width/height (1–100%). **Scale both axes together** starts enabled:
either size slider changes both percentages; enabling it again matches height to width.
Existing saved dimensions are not rewritten simply by opening the editor.

Coordinates describe the unwrapped model: X 50% faces front, X 0/100% meets at the back,
Y 0% is bottom and Y 100% top. Content wraps horizontally and clips vertically; caps are
undecorated. Generic boxes retain per-face mapping. Without a layout, text is centered and
the picture appears once on the front, keeping its proportions inside the default 30% × 60%
area (also the starting values of the placement controls); a stored texture placement
stretches the picture to exactly its box. **Reset text placement** and **Reset to default
placement** restore those defaults. Pictures keep their colors, laid over the filament with
a relief. Inner walls and the back of open surfaces are never decorated, so nothing shows
through the model. On plates with several objects (e.g. two vases side by side), every object
is wrapped around its own vertical axis and carries the plate's text and picture on its own
front; placement percentages refer to each object's surface. Loose pieces sharing one
footprint (stacked or nested shells) count as one object. Sample text/checker patterns are preview-only, not customer content.

Product preview links open `/product/:id` **inside this admin application**, behind
admin sign-in, including unpublished products. The local preview offers per-plate
appearance and shared scale controls without customer cart or order submission.

## Pricing and print options

**Pricing** (`/admin/pricing`) contains the rates that price measurements (orders that need a
quote, Print on Demand products) and the print options for customers' own models. Each section loads and saves independently. The old
`/admin/print-options` address redirects to Pricing.

**Print options** edits what customers choose from for prints of
their own models. **Slicing profiles**: the bundled printer, print profile (process) and
filament profile presets customers combine into the one profile their model is sliced with
(every preset is offered until narrowed down); a warning names printers without an offered
print profile and filament profile made for them, which customers don't get. **Filament types**:
name, description for customers, price per kilogram (USD, charged for the sliced grams on top of
the print time at the hourly rate), density (g/cm³) and the colors in stock (color picker, name,
hex code). Each filament shows what 100 g of it cost. Customers see only prices. Nozzle
diameters and layer heights are no longer offered to customers; the settings keep them for
orders placed before slicing profiles. New entries get ids from their names when saved. **Save changes** replaces
all options at once after the server's checks (problems are listed; edits are kept);
**Discard changes** reverts. New orders use the saved options; placed orders keep the
names and prices they were ordered with. The backend seeds example qualities and filaments.

## Orders

All orders are in one place, **Orders** (`/admin/orders`), whatever the customer ordered:
configured **catalog** products, their **own models** (uploaded STL/3MF files), models of an
**external project** (Thingiverse, Printables, MakerWorld) or a **Print on Demand** product. They
share the statuses, price rules, measurements, processing, log book and emails; only how the
models are shown and sliced depends on their source.

**List**: newest first with number, time placed, customer, models (with the source badge),
number of prints, price (the fixed price or the quote, else **Not quoted**; marked fixed price or
quote) and status. Filter by status and by source (`?source=upload` etc. in the address, so a filtered list
can be bookmarked), and search by order number, customer name or email, product, file or project
name. The header counts the orders, the value of those not cancelled or rejected, and how many
wait for a quote. The former addresses `/admin/custom-orders` and `/admin/project-orders` open the
list filtered by source (uploads, projects), and their order pages redirect to
`/admin/orders/:id`.

**Order page** (`/admin/orders/:id`): the number with the status and source, then on the left
**Models**, **Files for printing** (external project and Print on Demand orders), **Measurements
and price**, **Order processing** and the **Log book**, and on the right the **Price** card (fixed or
quoted price, handling fee, customer's estimate, price from the measurements) and the customer with
the shipping address and their note. **Delete order** removes the order and its log book (and the
customer's files).

**Models**, by source:

- **Catalog**: per item a rendered picture of the ordered print (the real model in the ordered
  colors, with engraving and texture; plates side by side), per-plate filament/text/texture
  choices and placement snapshots and the price breakdown. Every textured surface shows its image:
  either the shop texture snapshotted at checkout (name plus **Open original**, the
  full-resolution upload, even if the texture was later renamed or removed from the product) or the
  customer's own picture with **Download** (named after the order, item and plate). Click the
  picture to open the 3D viewer: an interactive preview of every plate exactly as ordered next to
  all order parameters — size, colors, engraving text/font/color, texture with placement,
  quantity, prices with breakdown and the texture files. Escape, **Close** or clicking outside
  closes it. The colors, text, placement and texture come from the order snapshot; the geometry
  comes from the product's current 3D model, so deleted products show the parameters only. Orders
  record each color part's key for this; older orders fall back to the product's current filament
  colors.
- **Own models**: files are private — the page downloads them with the admin key, one at a time,
  and reads them in the browser. Each model shows a rendered miniature in the ordered filament
  colors with its slicing profile (printer · print profile · filament profile, scale, supports) —
  or, for older orders, nozzle and layer height — and filament type and color per color part, its
  format, file size, dimensions, volume and triangle count (plus plate count for slicer projects,
  and a warning when larger than the 270 mm build volume) next to its copies. Clicking the
  miniature opens the model in 3D (slicer projects with all plates) with whether it fits the build
  volume; files that can't be read say why. **Download** saves the original as `<order
  number>-<file name>`, reusing the copy already downloaded; downloads are released when the page
  closes.
- **External project**: the project (thumbnail, author, license, link to the original page, a
  warning when the server could not verify it when the order was placed) and every model to print
  with its copies, scale and materials/colors (shown once when the customer used one selection for
  all models).
- **Print on Demand**: the product (link to its page) and the number of sets, **Print variants
  ordered** for sliced products (the scale of the set and every plate's variant with its presets,
  supports and options) and the product's models with the customer's colors; a warning when the
  customer chose other materials, so the order needs a quote.

**Files for printing** (external project and Print on Demand orders): every model file the order
prints — the models the customer chose from the project, or the models of the ordered product's
set — with its copies in the whole order (sets × copies per set), scale and materials/colors. The
shop keeps no copies: a file is downloaded from the project's site (through the server,
`GET /orders/:id/project-files/:fileId`) only when the admin saves or slices it. **Download** saves
a file as `<order number>-<file name>`; **Download all (.zip)** saves `<order number>-models.zip`
with every file and `print-list.txt`, which lists the order, the project link, the sets and scale
of Print on Demand sets, and each file's copies, scale and materials. Once downloaded, a row shows
the file's size and format (files other than STL/3MF can be saved but not sliced here); a file
downloaded once is reused while the page stays open (for saving, the archive and slicing) and is
gone when it closes. Print on Demand orders also list the shop's print file of the product. A file
that can't be downloaded shows why (e.g. the site no longer lists it, or MakerWorld needs
`MAKERWORLD_TOKEN` on the server) with **Try again** and a link to the project page; whole-project
items (the site lists no files) link to the project page.

**Measurements and price**: for every item, the shop's print time and filament of one copy (one
set for Print on Demand), sliced in the browser or entered by hand (**Enter by hand**). Slicing is
adapted to the source:

| Source | Model file | Slicer settings |
|---|---|---|
| Own models | the customer's file | exactly the customer's profile and scale (their browser sliced the same for the estimate); orders placed before slicing profiles: chosen by the admin |
| Catalog | the product's 3D model | the print variants the customer chose for every plate, at the ordered size; products priced by volume: chosen by the admin |
| Print on Demand | the product's print file; without one, every model of the set, downloaded from the project's site when sliced, each with its copies per set and scale, added up | the ordered print variants at the ordered scale; otherwise chosen by the admin, with a filament per model (starting with the material the customer asked for) |
| External project | the model, downloaded from the project's site when sliced (nothing to download or choose by hand) | chosen by the admin (printer, compatible process and filament, supports), starting with the material the customer asked for; the customer's scale |

If a file can't be downloaded from the site, or it isn't an STL/3MF, the admin can choose a file instead
(**Or choose the file yourself**); whole-project items always need one.

Every plate of a slicer project is sliced and added up, with progress. The result is editable,
with the sliced values kept for reference (**Use sliced values**): uploaded models have one row per
color part (priced with the filament the customer chose), other sources one row per material
(**+ Add material**). A live preview shows the copy price with the current rates; **Save
measurements** stores them (`PUT /orders/:id/items/:index/review`, priced by the server). Once
every item is measured, the price from the measurements (handling included) appears. Items
without a file to slice (a product without a 3D model or print file) are entered by hand.

**Order processing** sets the status — Received, Quoted, Accepted, Paid, In queue, Printing, Done,
Shipped, Delivered, Rejected, Cancelled — and the internal note. Orders that need a quote also have the
**Price** field (empty = not quoted) with **Use the measured price** and **Use the customer's
estimate**; an order can only be marked Quoted with a price, and the quote email states it.
Fixed-price orders show their price as placed, locked: measuring them is optional (e.g. to plan
printing) and never changes the price. When the status changes, **Email the customer about this
change** (on by default) sends the status template with an optional **Message for the customer**
(its `{{note}}`); a live preview shows the recipient, subject and text exactly as the server
renders them. Templates can require values: the message is marked required for cancelling or
rejecting, and a quote needs a price — the missing values are listed and saving waits for them.
**Save and send email** saves and reports whether the email was sent, saved to the development
outbox or not delivered (the status change is kept either way). **Message the customer** sends
your own email: start from a blank message or from any status template, edit subject and text,
then **Send email**; a failed delivery keeps the text for another try. A note says when the server
saves emails to its outbox (development) or can't send email.

**In queue**: choosing this status asks for the **Printer** whose queue the order joins (each
printer listed with its model, how many orders are in its queue and when an order queued now would
start) and the **Print time of the whole order** in minutes — prefilled from the shop's
measurements when every item is measured, otherwise entered. The order goes to the end of that
printer's queue; the status email states when printing is expected to start, how long it takes and
when it should be printed (queued orders print one after another with a 1 h break between prints),
and the preview shows these times before saving. For an order already in a queue the form says
where it waits; choosing another printer moves it to the end of that printer's queue (and emails
the customer the new times). The **Print queue** card beside the order shows the printer (a link to
its queue), print time, when it joined and its estimated start, or since when it prints. Setting
any status other than In queue or Printing — Done, Cancelled, Rejected, … — takes the order out of
its queue.

**Log book**: newest first — the status an order was placed with, every status change, every
email sent (automated with its status, or your own message; with delivery state and error) and
imported emails. **Import email (.eml)** adds emails saved from your mail program (one or
several files), e.g. the customer's replies: sender, recipients, date, subject, text and
attachment names are shown, **Download .eml** saves the original, an email already in the log is
refused, and senders other than the customer's address are flagged.

**Print on Demand product** (external project orders, below the log book): once every model is
measured, create a product from the order with a title, description (prefilled from the project)
and whether to publish it now. It keeps the measured print time and filament of one set; its price
is always calculated from them with the current rates.

**Email templates** (`/admin/email-templates`): one email per status, the same for every order.
Each editor lists its variables (`price`: the order's price or that it will be quoted; `items`:
one line per item; `printStart`, `printDuration`, `printEnd`: the print times of a queued order) — click one to insert it at the cursor; required ones are highlighted and must
stay in the template — and reports unknown or missing variables before saving. **Restore
default** brings back the shipped text; **Save changes** stores all templates.

The backend validates permissions and recalculates prices independently; frontend state is never
authoritative. 3MF rendering supports standard colors and Bambu/Orca palettes, extruder
assignments and painted triangles. PrusaSlicer-specific palettes and multiple beds are not
supported. Test models in `fixtures/models/` are private fixtures, not shared runtime assets.

## Print on Demand products

Products made from external project orders (see *Orders*) are sold to every customer at a price
calculated from one set's measurements. `/admin/print-on-demand` (the **Print on Demand** tab;
the former `/admin/ready-to-print` addresses redirect) lists these products with their current price, model count and a publish
toggle; `/admin/print-on-demand/:id` edits title, description, publication and the print time and
filament of one set, with the current price breakdown (more sets pay the handling fee once).

The same page sets up **slicing, as for catalog products**: upload the shop's **print file**
(STL, or a 3MF whose selected plates hold the project's models; read in the browser for its size
and plates), the **Scaling** card (customers may choose the set's size between the smallest and
largest scale; off: the original size only; example prices of one set with the default variants)
and **Print variants (slicing)** (printer × process × filament matrix per plate, supports and
options, sliced at the original size and both ends of the scale range; editable results).
**Save print setup** checks it like the product editor (variants on every included plate, sliced
at the range's ends) and uploads a new file only then. Once every plate offers a variant, the
price comes from the variants customers choose at their chosen size (the measurements card
notes it is not used then); the sidebar shows one set with the default variants at the original
size.

`/admin/pricing` holds the shop-wide rates: printer hourly rate, handling fee per order and price
per kilogram for PLA, PETG, ABS, ASA, TPU and resin. Catalog and Print on Demand prices and the
measurements of orders use them; placed orders keep their price, and a quote changes only when the
admin sets another.

## Slicer test

The **Slicer test** tab (`/admin/slicer`) slices a model **in the browser** and shows the
estimated print time and filament use, as OrcaSlicer would report them:

1. Choose a `.3mf` or `.stl` file. The page lists the objects, whether the model is painted
   with several filaments, the plates of a Bambu/Orca project and the printer saved in it.
2. Pick the printer, process and filament preset (only compatible presets are offered), or
   tick **Use the settings saved in the 3MF project**. Choose supports (off/on/as in the
   profile), the number of copies, a uniform scale (%), the plate, and optionally override any OrcaSlicer option
   (`key = value` per line, e.g. `sparse_infill_density = 25%`).
3. **Slice** runs the engine in a Web Worker (the page stays responsive; **Cancel** stops
   it). The result shows the time (Orca's truncated format and exact), grams/metres in total
   and per extruder, tool changes, layers, first-layer time and weight/time breakdowns
   (model, support, wipe tower, tool changes, travel). **Generate a downloadable G-code**
   adds a G-code download for inspection in a viewer (not meant for printing).

Nothing is uploaded or stored; the model never leaves the browser. Typical run times are
1–30 s; large painted multi-colour prints at 0.1 mm layers can take a few minutes.

The engine, the bundled printer presets (`profiles.json`) and the calibration in
`src/slicer/engine/` are a generated copy of the platform-neutral engine of the
[slicer estimator](../slicer/README.md) (accuracy, calibration and limitations are documented
there). Refresh it with `npm run sync-frontend` in `../slicer`, then run `npm test` and
`npm run build` here. The copy is owned by this application; nothing is imported from the
slicer package at runtime. `src/slicer/` also contains the worker (`slicer.worker.ts`),
its typed client (`client.ts`) and the form helpers; tests slice generated STL/3MF cubes
with the real engine and exercise the page with a fake worker.

## Printers

The **Printers** tab is the printers warehouse. A switch at the top of its pages moves between
**Printers** (`/admin/printers`) and **Printer models** (`/admin/printer-models`).

**Printer models** hold everything that is the same for every printer of a model: the print
plate size (width × depth × maximum height in millimeters), how many colors one job can use, and
the slicer profiles. Printers only refer to their model, so every change to a model shows on all
its printers at once; these values can't be edited on a single printer.

- The list shows each model with its manufacturer, plate size, colors, profile archive and the
  printers of that model. **Add printer model** and **Edit** open the model's own page
  (`/admin/printer-models/new`, `/admin/printer-models/:id`).
- On that page, a new model can **start from a known printer** (the server's catalog of common
  desktop printers fills in name, manufacturer, plate size and colors, which can still be
  changed). Model names are unique, ignoring case. Saving a new model opens its edit address;
  saving an existing one stays on the page, and says how many printers the change applies to.
  The page lists the printers of the model.
- **Printer profiles** are one ZIP archive per model, e.g. an OrcaSlicer printer export
  (`.orca_printer` files are ZIPs), up to 20 MB. The file chosen on the page is uploaded when the
  model is saved (a new model is created first; if the upload then fails, the model is shown as
  saved with the error, and the file can be chosen again). The page shows the archive's name,
  size, upload time and the printer/process/filament presets the server found in its JSON files;
  **Archive contents** lists every file. **Download** fetches the archive with the admin key;
  **Remove** deletes it when the model is saved; choosing another file replaces it.
- A model can only be deleted while no printer uses it (the button is disabled, and the server
  refuses, naming the printers); its archive is deleted with it.

**Printers** lists every printer in the workshop, sorted by name, with its model (a link to the
model's page), the model's plate size, colors and profiles (downloadable from the list) and its
**Queue** (number of orders and the next free start). The printer's name and queue link to its
queue.

**Printer queue** (`/admin/printers/:id`): the order being printed (highlighted), then the waiting
orders in the order they joined, each with its position, number (a link to the order), source,
customer, models, status, print time and estimated start and end — recalculated from now, with a
1 h break between prints. **Start printing** sets an order to Printing (only while the printer
prints nothing else), **Done** marks it printed (status Done, out of the queue), **Remove from
queue** (after confirmation) returns it to the status it had before queueing. **Email the
customer about each status change** (on by default) sends the status emails. Orders join a queue
from their order page (status In queue). A printer with orders in its queue can't be deleted.

- **Add printer** / **Edit** open a form above the list with only the printer's own fields: a
  **unique name** (e.g. `U1-01`; the server refuses a name another printer has, ignoring case, and
  the form flags it before saving), the **model** (chosen from the printer models), **location**
  (free text describing the physical standing place) and optional **notes**. The chosen model's
  plate size, colors and profiles are shown read-only with a link to edit the model.
- Printers need a model: until one exists, **Add printer** is disabled and the page links to
  adding a model.
- **Delete** removes the printer after confirmation.

Printers and models are stored by the backend (`/api/printers`, `/api/printer-models`, see its
README); the storefront does not use them.
