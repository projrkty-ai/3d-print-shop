# Customer storefront agent guide

## Scope and application boundary

This file applies to the whole customer frontend. Start with [README.md](README.md),
[package.json](package.json) and the relevant feature's existing tests.

- Standalone Node 22+ tooling; React 19, TypeScript, Vite, React Router, Three.js,
  React Three Fiber and drei. This is a client-rendered SPA, not Next.js or an RSC app.
- Own all source, types, utilities, fixtures, dependencies and tests locally. Do not
  import backend/admin source, create shared packages/workspaces/symlinks or require a
  parent npm project. Similar domain code in other applications is intentionally independent.
- Integrate only over HTTP/JSON. Coordinate contract changes explicitly; do not assume
  changing a local interface changes the server. Backend validation/pricing is authoritative.
- Never introduce admin routes, admin token storage/headers or product/order-management
  endpoints. The legacy `?preview=1` flag must not expose unpublished products here.

## Commands and hosting

Run commands from this application directory.

| Purpose | Command |
|---|---|
| Install from lockfile when needed | `npm ci` |
| Development (port 5173) | `npm run dev` |
| Customer state/appearance regression tests | `npm test -- src/pages/ProductPage.test.tsx` |
| App boundaries and asset resolution | `npm test -- src/App.test.tsx src/api/urls.test.ts` |
| Surface rendering and thumbnail regression tests | `npm test -- src/utils/surfacePainting.test.ts src/utils/modelThumbnail.test.ts src/components/ProductThumbnail.test.tsx` |
| Check application and test types | `npm run typecheck` |
| Production build | `npm run build` |
| Full suite / built preview (port 4173) | `npm test` / `npm run preview` |

No lint script or installed Playwright test runner exists. Use existing Vitest/jsdom
patterns; do not add frameworks for a small test. Build includes both type-checks and Vite.

`VITE_API_URL` is the public API base including `/api`; `API_PROXY_TARGET` configures
development/preview proxies for `/api` and `/models`. For separate origins, resolve model
and photo paths with the local API URL helpers, preserving external/data/blob URLs.
Do not rewrite product URLs in persistence just to fix hosting. `VITE_*` values are
public build-time data; never put secrets in them. Deployment needs SPA route fallback.

`VITE_APP_LANGUAGE=pl|en` selects static copy and number/plural formatting at build time;
the supplied `.env` selects Polish. Use the local typed `t()` helper and `src/i18n/pl.json`
for all static UI, validation and accessible labels. Preserve placeholders, identifiers,
currency and actual catalog/customer content. Never translate by mutating the rendered DOM.
Tests pin English; maintain dedicated Polish coverage when adding messages.

## Code map

| Concern | Entry points |
|---|---|
| Routes and customer-only providers | [src/App.tsx](src/App.tsx), [src/components/Layout.tsx](src/components/Layout.tsx) |
| Catalog, configuration, cart and checkout | [src/pages/](src/pages/) |
| Configurator orchestration | [src/pages/ProductPage.tsx](src/pages/ProductPage.tsx) |
| Reusable appearance and size controls | [src/components/customization/](src/components/customization/) |
| Rich descriptions, safe embeds and carousel | [src/components/ProductDescription.tsx](src/components/ProductDescription.tsx), [src/utils/productDescription.ts](src/utils/productDescription.ts) |
| Products and cart state | [src/store/ProductsContext.tsx](src/store/ProductsContext.tsx), [src/store/CartContext.tsx](src/store/CartContext.tsx) |
| Versioned drafts and browser persistence | [src/store/useProductDraft.ts](src/store/useProductDraft.ts), [src/store/usePersistentState.ts](src/store/usePersistentState.ts) |
| HTTP requests and asset origins | [src/api/](src/api/) |
| Local types, configuration and domain calculations | [src/types.ts](src/types.ts), [src/config.ts](src/config.ts), [src/utils/](src/utils/) |
| Live previews and static thumbnails | [src/components/ProductPreview.tsx](src/components/ProductPreview.tsx), [src/utils/modelThumbnail.ts](src/utils/modelThumbnail.ts) |
| Styling / binary test assets | [src/index.css](src/index.css), [fixtures/models/](fixtures/models/) |

Fixtures and seed data support tests; runtime products and model files come from the API.

## Customer behavior to preserve

- Keep description/carousel on the left and all configuration/previews/cart actions on
  the right; mobile stacks description first. Escape legacy plain descriptions; sanitize
  HTML only when `descriptionFormat: 'html'`. Inline images/videos remain in place and
  also join the deduplicated carousel with the product photo and carousel-only `gallery`.
  Create iframe embeds only for recognized YouTube/Vimeo URLs; no raw iframe HTML.
  Videos require controls and no autoplay. Resolve uploaded image paths to the API origin.
- The customer carousel has no media-selection list below it: use full-height left/right
  edge buttons, an overlaid count, directional slide transitions and fading arrow icons.
  Keep keyboard focus visible and touch arrows discoverable; respect reduced motion.
  Reserve edge space for video navigation so controls are not covered. Outgoing images
  may animate as inert/aria-hidden decoration, but unmount outgoing videos immediately.
- A product can be a complete set of selected 3MF plates. Each plate has its own filament/
  part colors, text, font, lettering color and texture; dimensions and scale are shared.
  Do not price or order the currently viewed plate in isolation.
- Keep legacy single-plate selection and root appearance fallback for older carts.
  Use `includedProductPlates`, `plateParts`, `customizationSurfaces` and normalization
  rather than duplicating rules in components.
- Size editing is proportional to original dimensions, rounded to 0.1 mm, with 5-270 mm
  bounds. Three.js order is width/height/depth, not width/depth/height. Invalid or empty
  numeric fields remain editable: show errors, stabilize only the preview, and block
  ordering instead of silently clamping the customer's stored input.
- Display pricing must retain set-level fixed/engraving/colored-engraving/texture fees
  and once-per-filament surcharges. Checkout can return recalculated prices; keep its
  price-change explanation. There is no online payment flow to claim as completed.
- Drafts use `printforge.productDraft:<id>`, version 1; cart uses `printforge.cart`.
  Preserve state per product across navigation, reload and adding to cart, including
  quantity and every plate's texture. Never restore the transient "added" success message.
- Validate persisted data, normalize obsolete product choices, and preserve invalid text
  for correction. Cleared dimensions are `NaN` in memory and `null` in saved JSON; maintain
  that round trip. Evolve draft formats with explicit migration/version handling.
- Storage may be full/blocked: retain in-memory editing, log failures and show the existing
  persistence warning. Do not silently drop textures, clear all site data, or claim a save.
- Use functional updates for plate patches, especially asynchronous image completion,
  so a finished upload cannot overwrite more recent text/color edits.
- Decoration placement is administrator-owned: consume root/per-plate layouts, do not
  offer overrides or make client layout authoritative. Missing settings preserve centered
  lettering and repeated texture.

## 3D and UI constraints

- Keep parsing/rendering lazily loaded. Preserve STL and standard 3MF colors plus Bambu/
  Orca palettes, extruders and recursive painted triangles. Do not claim unsupported
  PrusaSlicer palettes/beds. Malformed models need visible errors, not fake successful previews.
- File geometry is Z-up; preview preparation converts to Y-up. Reuse the geometry/UV/
  material-slot helpers; keep cap behavior and part IDs stable. Apply identical text
  transforms to engraving surface and color mask in `surfacePainting`.
- Dispose geometries, materials, textures and owned object URLs when replaced/unmounted.
  Do not create WebGL contexts per catalog card. Thumbnails prefer product photos, otherwise
  render actual geometry; preserve bounded caching, shared renderer cleanup and explicit
  loading/error states.
- Use existing CSS/components, localized UI copy and accessible native controls. Labels must
  target inputs (including sliders), IDs/radio names must be unique across plates, and
  status/errors must remain perceivable without relying on color or the 3D canvas.

## Verification and working practices

Use strict TypeScript and typed guards, existing formatting and `import type`. Avoid
unnecessary casts, broad catches and new global state. Reuse local helpers; do not change
unrelated behavior. Keep the local lockfile and README current when their contracts change.

Run focused tests for the touched surface and type-check; use the full build for routing,
dependencies or bundling changes. Tests default to Node; DOM files opt into jsdom.
Follow existing React `act`/`createRoot` and native value-setter event helpers. Restore
storage, mocks, globals, roots and intercepted requests after tests.

For UI changes, exercise navigation/reload and a multi-plate plus non-plate product.
For 3D changes, test actual material/canvas/geometry results, not only mocked props.
Hidden browser pages can throttle animation/IntersectionObserver: inspect visibility and
render state before blaming application code; do not ship timer hacks to satisfy that
environment. Use fixtures/interception, never real checkout or destructive data changes.
Report exact validation performed and any unverified browser/GPU behavior.
