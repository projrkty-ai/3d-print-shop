# Administrator frontend agent guide

## Scope and application boundary

This file applies throughout the administrator application. Read [README.md](README.md),
[package.json](package.json), and tests for the feature before editing it.

- Standalone Node 22+ tooling; React 19, TypeScript, Vite, React Router, Three.js,
  React Three Fiber and drei. Keep this a client-rendered admin SPA.
- All types, validation, preview helpers, assets and dependencies belong to this application.
  No imports from backend/storefront source, shared packages, workspaces, symlinks or
  parent build requirements. Duplicate domain helpers are intentional independent copies.
- HTTP/JSON is the integration boundary. For schema/pricing changes, identify affected
  backend/customer consumers and coordinate only the requested cross-application changes,
  without introducing source coupling.
- No customer cart, checkout, order-submission flow or customer draft storage belongs here.
  Unpublished product previews must remain local, authenticated admin routes.

## Commands and configuration

Run commands in this directory.

| Purpose | Command |
|---|---|
| Install from lockfile when needed | `npm ci` |
| Development (port 5174) | `npm run dev` |
| Authentication/routes and API asset origins | `npm test -- src/App.test.tsx src/api/urls.test.ts` |
| Editor, per-plate placement and linked scaling | `npm test -- src/pages/admin/ProductEditorPage.test.tsx` |
| Drawing/layout tests | `npm test -- src/utils/surfacePainting.test.ts src/utils/decorationLayout.test.ts` |
| Thumbnail lifecycle tests | `npm test -- src/utils/modelThumbnail.test.ts src/components/ProductThumbnail.test.tsx` |
| App and test types | `npm run typecheck` |
| Production build / full suite | `npm run build` / `npm test` |
| Built preview (port 4174) | `npm run preview` |

Build includes type-checking and Vite output. There is no lint script or installed
Playwright test runner. Prefer existing tests/tools and maintain this app's lockfile.

See [.env.example](.env.example): `VITE_API_URL` includes `/api`; `API_PROXY_TARGET` serves
development/preview `/api` and `/models` proxies; `VITE_STOREFRONT_URL` is the external
shop link. Resolve persisted relative model/photo paths through the local API URL helpers.
`VITE_APP_LANGUAGE` selects this app's static UI: `en` (default only when unset) or `pl`.
The example/local environment selects Polish; invalid/empty values must fail explicitly.
Restart development or rebuild production after changing it. Tests explicitly use `en`
regardless of deployment `.env`, with focused tests covering both languages.
Do not overwrite stored URLs with deployment-specific origins. Public `VITE_*` values
must never contain `ADMIN_TOKEN`; the key is entered by the administrator at sign-in.

## Code map

| Concern | Entry points |
|---|---|
| Routes, guards and shell | [src/App.tsx](src/App.tsx), [src/pages/admin/AdminLayout.tsx](src/pages/admin/AdminLayout.tsx) |
| Sign-in, tab-scoped token, authenticated HTTP | [src/store/AdminAuthContext.tsx](src/store/AdminAuthContext.tsx), [src/api/](src/api/) |
| Products, loading and mutation state | [src/store/ProductsContext.tsx](src/store/ProductsContext.tsx) |
| Product list / editor | [src/pages/admin/AdminProductsPage.tsx](src/pages/admin/AdminProductsPage.tsx), [src/pages/admin/ProductEditorPage.tsx](src/pages/admin/ProductEditorPage.tsx) |
| WYSIWYG description / product media / carousel preview | [src/components/DescriptionEditor.tsx](src/components/DescriptionEditor.tsx), [src/components/ProductMediaManager.tsx](src/components/ProductMediaManager.tsx), [src/components/ProductDescription.tsx](src/components/ProductDescription.tsx), [src/utils/productDescription.ts](src/utils/productDescription.ts) |
| Model analysis / decoration controls | [src/pages/admin/ModelFileCard.tsx](src/pages/admin/ModelFileCard.tsx), [src/pages/admin/DecorationLayoutEditor.tsx](src/pages/admin/DecorationLayoutEditor.tsx) |
| Interactive admin-only product preview | [src/pages/ProductPreviewPage.tsx](src/pages/ProductPreviewPage.tsx) |
| Orders and cancel-safe fetching | [src/pages/admin/AdminOrderPage.tsx](src/pages/admin/AdminOrderPage.tsx), [src/pages/admin/AdminOrdersPage.tsx](src/pages/admin/AdminOrdersPage.tsx), [src/pages/admin/useAdminData.ts](src/pages/admin/useAdminData.ts) |
| Snapshot display | [src/components/ConfiguredItem.tsx](src/components/ConfiguredItem.tsx) |
| Local types, domain calculations, geometry and painting | [src/types.ts](src/types.ts), [src/config.ts](src/config.ts), [src/utils/](src/utils/) |
| Styles / private test models | [src/index.css](src/index.css), [fixtures/models/](fixtures/models/) |

## Authentication and data safety

- `/` redirects to `/admin`; `/product/:productId` previews remain behind `AdminLayout`.
  Never send the admin token to the shop via URL/query string, external link or build
  variable. Preserve the existing tab-scoped `printforge.adminToken` sessionStorage key.
- Product reloads react to sign-in/out; maintain canceled-request guards. Order fetching
  uses `useAdminData`, including sign-out on 401. Never bypass backend authorization just
  because a screen is hidden or a client token exists.
- Surface API failures using `ApiError`, load/error states and current banners. Show
  validation details; do not show a saved-success state before the API succeeds.
- Browser verification must use mocks/fixtures or explicit permission for writes.
  Publishing, deletion, duplication, uploads and order changes affect real shared data.
  Keep destructive-action confirmation and do not log credentials or customer details.

## Product editing invariants

- Use Tiptap for rich descriptions; preserve plain text until an actual edit opts into
  `descriptionFormat: 'html'`. Sanitize HTML and never accept arbitrary iframe markup.
  Images support links or immediate PNG/JPEG/WebP/GIF uploads (10 MB); video is links
  only (YouTube/Vimeo/MP4/WebM). Disable product Save during image upload and show errors.
  This immediate upload is distinct from model files uploaded on Save. Images are public,
  retained on cancellation/removal/deletion, and may be reused by duplicated products.
  Inline media stays inline and also joins the top carousel. `gallery` entries are
  carousel-only. Never strip inline media merely to populate the carousel.
- Process every selected image, not only `files[0]`. Keep the product Save disabled for
  the whole batch, retain successes, report filenames on failure and continue remaining
  uploads. Insert after the current selection without replacing selected media or text.
  The per-product media manager lists all inline occurrences, gallery entries and the
  product photo. Preserve surrounding text when moving/removing media, use functional
  gallery updates, and block Save until row edits are applied or cancelled. Keep row
  identity stable when description positions or gallery ordering change.
- Initialize Tiptap after commit (`immediatelyRender: false`) and never read HTML or
  render controls from a destroyed instance. Lazy loading, StrictMode and Suspense
  can reconnect effects holding an old editor. Cover lifecycle recovery as well as
  ordinary editing; do not remove StrictMode to hide a blank-page crash.
- The editor owns a cloned draft; preview-only text/checker pattern and temporary
  appearance choices are not saved as customer content.
- **Save product** stays in the editor; newly created products replace the new-product
  URL with their saved edit URL. **Save and exit** returns to the list only on success.
  Lock persisted controls while saving, display failures and reuse an uploaded model
  URL across retries/repeated saves rather than uploading the same pending file again.
- Inline video node views provide a drag handle outside the embedded/native player's
  event surface and up/down controls. Move the actual document node, preserve text and
  selection/history, and never serialize editor controls or iframe markup into HTML.
- Analyze a picked model locally and preview with an object URL. Upload only on Save,
  replace the blob URL with the API result, then save metadata. Revoke owned blob URLs
  on replacement/unmount. Do not upload on file selection or delete a shared backend
  file directly from the browser.
- One or more selected 3MF plates form one product set. Changing selection reanalyzes
  dimensions/volume and keeps existing layout by plate ID plus renamed part labels.
  Replacing the file clears old plate layouts. Do not persist embedded plate thumbnails.
- Use the max extent per axis for set dimensions and sum plate volume. Do not use
  side-by-side preview bounds as manufacturing dimensions. Quantities count complete
  sets, all plates share a scale, and fees remain once per set/filament as implemented.
- Keep legacy `mesh.plate`, omitted `selectedPlates` and root customization fallbacks.
  Reject an empty explicit plate set; do not silently include unselected archive objects.
- Text position/alignment belongs inside **Engraving**, texture center/size inside
  **Picture texture**. Their plate selectors and live preview stay synchronized. Disabling
  an option hides controls without erasing the draft's settings.
- Text uses X/Y anchors, left/center/right and top/middle/bottom alignment, not independent
  stretching. Horizontal alignment is per line; vertical alignment is for the block.
  Texture centers are 0-100%, sizes 1-100%. Validate through the existing helpers.
- **Scale both axes together** starts enabled as UI-only state: editing either dimension
  sets both percentages; reenabling matches height to current width. Merely mounting
  controls or opening an old product must not rewrite saved independent dimensions.
- Layout is per plate; products without plates use the root layout. Missing text settings
  preserve centered text; missing texture settings preserve repeating texture. Reset
  removes only the targeted override and keeps the other decoration intact.
- Preview pricing is informational. The backend validates and reprices orders; product
  edits must not rewrite historical appearance/layout snapshots in existing orders.

## Rendering and implementation conventions

Reuse local parser, mesh/plate, sizing and painting helpers. File geometry is Z-up;
preview is Y-up with scale `[width, height, depth]`. UI dimensions use mm and volume cm3.
Sizing bounds and fees come from constants/domain helpers, not hard-coded component logic.

Preserve standard 3MF and Bambu/Orca colors, extruders and painted subdivision. PrusaSlicer
palettes/multiple beds are not supported. Keep heavy parsing/Three.js lazily loaded,
visible error states and resource disposal. Thumbnails use photos first, otherwise real
geometry through a bounded cache and one temporary off-screen renderer, not a canvas
per product row.

Decoration UV X wraps around the surface (50% front, 0/100% back); Y goes bottom to top.
Keep seam wrapping, vertical clipping, generic-box per-face behavior and undecorated
caps. `surfacePainting` must apply identical text transforms to grooves and color masks.

Follow strict TypeScript, `import type`, local formatting and existing component/CSS
patterns. Preserve meaningful `null` contract fields. Avoid `any`, broad catches, new
global state or unrelated refactors. Labels must resolve to controls, including sliders;
use stable IDs/radio names for repeated plate UI and accessible loading/error feedback.

Keep static UI translations in the local typed `src/i18n/` dictionaries and use source-level
`t` calls, including validation, editor node-view controls and aria/title/placeholder text.
Use the selected locale for display formatting without changing USD or machine-readable
input/JSON values. Vite localizes document metadata at build/dev-serving time; never add
DOM-scanning translation or modify serialized editor markup. Do not translate stored
product descriptions/names, customer/media text, notes, snapshots or API-provided details.
Never localize status IDs, mesh/plate/part keys, shape values, font names or storage keys.

## Verification checklist

Run the smallest relevant Vitest selection and type-check for code changes; build for
route, dependency or bundling changes. Extend existing jsdom/React `act`/`createRoot`
tests and native setter/event helpers instead of introducing another test framework.
Pure drawing tests can use typed canvas doubles; DOM tests opt into jsdom.

Check independent plate edits, switching/reanalysis/replacement, reset behavior, disabled
options, non-plate products, exact linked-axis outputs and saved payloads. For auth/API
changes check unauthenticated routes, failures and correct asset origin resolution.
Restore all test globals, requests, storage and object URL stubs.

For visual/geometry changes validate actual canvas/material/geometry output as well as
UI props. Hidden browser pages can throttle animation and observers; investigate that
before adding application workarounds. Do not rely solely on a blank hidden-tab screenshot.
Update the local README for behavior/hosting changes, keep this guide aligned when its
commands or invariants change, and report checks and unverified aspects accurately.
