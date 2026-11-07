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
Editor: metadata/photo, original dimensions and solid volume, dynamically estimated prices,
filament options, engraving limits/fonts/text colors and picture-texture fee. STL/3MF
uploads populate model measurements. Selected Bambu/Orca plates are sold as one set,
with separate appearances and one customer scale. Switching selected plates preserves
their layout; replacing the model clears old plate layouts.

Catalog prices use Pricing's hourly and material rates: estimated weight is model volume
× 1.3 g/cm³ × 30%; estimated print time is weight ÷ 20 g/hour. Both scale with volume.
Handling is charged once per order, not per item or set. Product material names map to
PLA (including PLA+), PETG, ABS, ASA, TPU or resin; unrecognized names use PLA.
The product list, editor examples and previews show dynamic print prices before handling
and customization surcharges. Legacy base price/fixed fee are retained, shown read-only,
and do not affect current orders. Derived rates are excluded from product save payloads.
New products load current rates even when the catalog is empty.

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

**Pricing** (`/admin/pricing`) contains the rates for project orders and the print options
for customers' own models. Each section loads and saves independently. The old
`/admin/print-options` address redirects to Pricing.

**Print options** edits what customers choose from for prints of
their own models. **Nozzle diameters**: diameter, price multiplier (smaller nozzles print
slower) and the default; each row shows the layer heights it can print — from a quarter to
0.8 × its diameter — or warns when none fits. **Layer heights**: height, price multiplier
(thinner layers take longer) and the default; each row shows which nozzles can print it. A
warning appears when the default layer height doesn't suit the default nozzle; the server
rejects such settings and nozzles without a usable layer height. **Filament types**: name,
description for customers, price per kilogram (USD), density (g/cm³, converts volume to
weight) and the colors in stock (color picker, name, hex code). Each filament shows what a
100 cm³ model costs in it with the default nozzle and layer height. Customers see only prices;
the admin also sees estimated weights on print requests. New entries get ids from their names when saved. **Save changes** replaces
all options at once after the server's checks (problems are listed; edits are kept);
**Discard changes** reverts. New requests use the saved options; placed requests keep the
names and prices they were ordered with. The backend seeds example qualities and filaments.

## Print requests

**Print requests** (`/admin/custom-orders`) lists customers' requests to print their own
STL/3MF files: number, submission time, customer, files with total prints, quote and status,
with search (number, name, email, file name) and status filtering. New requests are
**Awaiting review**. A request shows its files, the customer's printing instructions, contact
and delivery details. Files are private: opening a request downloads them with the admin key,
one at a time, and reads them in the browser. Each model then shows a rendered miniature with
its chosen nozzle, layer height, and filament type and color per color part,
its format, file size, dimensions, volume and triangle count (plus plate count for slicer
projects, and a warning when larger than the 270 mm build volume) next to its copies.
Miniatures and the 3D view show the model in the ordered filament colors. Each file also shows
an estimate from the ordered prices and the shop's own reading of the file (the same formula
the customer saw), and **Order processing** totals it with **Use estimate** to copy it into
the quoted price. Requests placed before print options existed show no options or estimate.
Clicking the miniature or description opens the model in 3D (slicer projects with all plates)
with the same details and whether it fits the build volume; files that can't be read say why
and don't open. **Download** saves the original file as `<request number>-<file name>`, reusing
the copy already downloaded; downloads are released when the page closes. The page has the
models, **Order processing** and the **Log book** (see below) on the left, and the customer's
printing instructions and contact details on the right. Order processing sets the status
(Awaiting review, Approved, Rejected, Printing, Shipped, Delivered, Cancelled), the quoted price
(empty = not quoted) and an internal note. Deleting a request also deletes its files and log
book.

## Order processing, log book and emails

Catalog orders and print requests share the same panels below their items or models:

**Order processing**: the status, the internal note (and for print requests the quoted price).
When the status changes, **Email the customer about this change** (on by default) sends the
status template with an optional **Message for the customer** (its `{{note}}`); a live preview
shows the recipient, subject and text exactly as the server renders them. Templates can
require values: the message is marked required for cancelling or rejecting, and approving a
print request needs a quoted price — the missing values are listed and saving waits for them.
**Save and send email** saves and reports whether the email was sent, saved to the
development outbox or not delivered (the status change is kept either way). **Message the
customer** sends your own email: start from a blank message or from any status template,
edit subject and text, then **Send email**; a failed delivery keeps the text for another try.
A note says when the server saves emails to its outbox (development) or can't send email.

**Log book**: newest first — the status an order was placed with, every status change, every
email sent (automated with its status, or your own message; with delivery state and error) and
imported emails. **Import email (.eml)** adds emails saved from your mail program (one or
several files), e.g. the customer's replies: sender, recipients, date, subject, text and
attachment names are shown, **Download .eml** saves the original, an email already in the log is
refused, and senders other than the customer's address are flagged.

**Email templates** (`/admin/email-templates`): the email for each status of orders and print
requests. Each editor lists its variables — click one to insert it at the cursor; required ones
are highlighted and must stay in the template — and reports unknown or missing variables before
saving. **Restore default** brings back the shipped text; **Save changes** stores all templates.

## Orders

Order list: status filtering, text search, totals. Details: customer/shipping information,
per-plate filament/text/texture choices and placement snapshots, price breakdown, order
processing and the log book (above). Every textured surface shows its image: either the shop
texture snapshotted at checkout (name plus **Open original**, the full-resolution upload,
even if the texture was later renamed or removed from the product) or the customer's own
picture with **Download** (named after the order, item and plate). The backend validates
permissions and recalculates prices independently; frontend state is never authoritative.

Each item shows a rendered picture of the ordered print (the real model in the ordered
colors, with engraving and texture; plates side by side). Click it to open the 3D viewer:
an interactive preview of every plate exactly as ordered next to all order parameters —
size, colors, engraving text/font/color, texture with placement, quantity, prices with
breakdown and the texture files. Escape, **Close** or clicking outside closes it. The
colors, text, placement and texture come from the order snapshot; the geometry comes
from the product's current 3D model, so deleted products show the parameters only.
Orders record each color part's key for this; older orders fall back to the product's
current filament colors.

3MF rendering supports standard colors and Bambu/Orca palettes, extruder assignments
and painted triangles. PrusaSlicer-specific palettes and multiple beds are not supported.
Test models in `fixtures/models/` are private fixtures, not shared runtime assets.

## Project orders

`/admin/project-orders` lists customers' requests to print projects from Thingiverse,
Printables and MakerWorld (`GET /project-orders`), searchable by number, customer or project
and filterable by status. `/admin/project-orders/:id` shows the project (thumbnail, author,
license, link to the original page, a warning when the server could not verify it), every
model to print with its quantity, scale and materials/colors (shown once when the customer
used one selection for all models), the customer's notes and the customer, and lets the admin change the status
(new → quoted → accepted → printing → shipped, or cancelled), keep an internal note, or delete
the order.

**Price** (on the project order page). Orders that need a quote — projects found by search,
and ready-to-print products ordered with other materials (marked by a warning) — show the
**price review**: enter the total print time (hours and minutes) and the filament used per
material (rows start with the materials the customer asked for). A live breakdown shows
handling fee + print time × hourly rate + each material's weight × price per kg = total with
the current rates; **Save review** stores it as the order's price (`PUT
/project-orders/:id/review`, priced by the server), and it can be changed again while the order
needs a quote. Fixed-price orders (a ready-to-print product ordered with its own materials, any
colors) show their price as placed, locked. The order list shows each order's price and whether
it is a quote or a fixed price.

**Ready-to-print product** (below the price): once a review is saved, create a product from it
with a title, description (prefilled from the project) and whether to publish it now. It keeps
the review's print time and filament; its price is always calculated from them with the current
rates.

`/admin/ready-to-print` lists these products with their current price, model count and a publish
toggle; `/admin/ready-to-print/:id` edits title, description, publication and the print time and
filament of one set, with the current price breakdown (more sets pay the handling fee once).

`/admin/pricing` holds the shop-wide rates: printer hourly rate, handling fee per order and price
per kilogram for PLA, PETG, ABS, ASA, TPU and resin. Catalog and ready-to-print prices use them;
placed orders keep their price, and quotes change only when the review is saved again.
