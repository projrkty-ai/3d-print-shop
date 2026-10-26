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
Editor: metadata/photo, original dimensions and solid volume, base price/fixed fee,
filament options, engraving limits/fonts/text colors and picture-texture fee. STL/3MF
uploads populate model measurements. Selected Bambu/Orca plates are sold as one set,
with separate appearances and one customer scale. Switching selected plates preserves
their layout; replacing the model clears old plate layouts.

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

Text placement is inside **Engraving**; texture placement/size is inside **Picture
texture**. Plate selectors in these sections stay synchronized with the live preview.
Text uses X/Y anchors and left/center/right plus top/middle/bottom alignment. Texture
uses a center and width/height (1–100%). **Scale both axes together** starts enabled:
either size slider changes both percentages; enabling it again matches height to width.
Existing saved dimensions are not rewritten simply by opening the editor.

Coordinates describe the unwrapped model: X 50% faces front, X 0/100% meets at the back,
Y 0% is bottom and Y 100% top. Content wraps horizontally and clips vertically; caps are
undecorated. Generic boxes retain per-face mapping. Missing layouts preserve centered
text and repeating texture; reset buttons restore those defaults. Sample text/checker
patterns are preview-only, not customer content.

Product preview links open `/product/:id` **inside this admin application**, behind
admin sign-in, including unpublished products. The local preview offers per-plate
appearance and shared scale controls without customer cart or order submission.

## Orders

Order list: status filtering, text search, totals. Details: customer/shipping information,
per-plate filament/text/texture choices and placement snapshots, uploaded texture images,
price breakdown, status changes and internal notes. The backend validates permissions
and recalculates prices independently; frontend state is never authoritative.

3MF rendering supports standard colors and Bambu/Orca palettes, extruder assignments
and painted triangles. PrusaSlicer-specific palettes and multiple beds are not supported.
Test models in `fixtures/models/` are private fixtures, not shared runtime assets.
