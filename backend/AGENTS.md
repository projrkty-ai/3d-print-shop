# Backend agent guide

## Scope and application boundary

This file applies to the entire backend application. Read [README.md](README.md) for
setup and HTTP endpoints, and [package.json](package.json) before choosing commands.

- This is a standalone Node 22+ application: TypeScript ESM, Express 5, MongoDB 7 driver,
  Zod 4, Vitest and Supertest. MongoDB server versions are configured separately.
- Keep source, domain rules, tests, dependencies and assets inside this application.
  Do not introduce imports from either frontend, shared packages, workspace dependencies,
  symlinks or a root build requirement. Intentional copies of domain logic are not an
  invitation to extract a cross-application library.
- The integration boundary is HTTP/JSON. For a contract change, identify affected
  consumers, preserve backward compatibility where possible, and explicitly report any
  required frontend updates. If the task includes multiple applications, change their
  local implementations separately and validate each.
- Serve API endpoints and model assets, never storefront or administrator HTML.

## Commands and environment

Run commands from this directory, not the parent directory.

| Purpose | Command |
|---|---|
| Install from lockfile when needed | `npm ci` |
| Develop against local MongoDB | `npm run dev` |
| Start local MongoDB when needed | `docker compose up -d` |
| Target API behavior | `npm test -- src/api.test.ts` |
| Target domain behavior | `npm test -- src/domain/utils/pricing.test.ts src/domain/utils/plateCustomization.test.ts` |
| Check all server and test types | `npm run typecheck` |
| Backend build gate | `npm run build` |
| Full test suite | `npm test` |
| Production process | `npm start` |

`build` is a type-check, not JavaScript emission; production runs source using the
declared `tsx` runtime. There is no lint script. Do not add a tool just to invent a check.
Install dependencies only when missing or changing manifests; maintain the local lockfile.

Use [.env.example](.env.example) as the configuration reference: `MONGODB_URI`, `PORT`
(default 3001), `ADMIN_TOKEN`, and `CORS_ORIGINS`. Never read out, commit or log real
credentials/customer data. Do not run `db:seed -- --reset`, prune uploads, or delete a
database/Compose volume against existing data without explicit approval.

`APP_LANGUAGE` selects `en` (default when unset) or `pl`; other values fail explicitly.
Use the local typed `t` helper in `src/i18n.ts` for static client-facing messages.
Never translate identifiers, stored product/customer content or existing order snapshots.
Vitest selects English independently of the app environment; localization tests also
exercise Polish and invalid configuration.

## Where changes belong

| Concern | Entry points |
|---|---|
| Startup, indexes, migrations, graceful shutdown | [src/index.ts](src/index.ts), [src/db.ts](src/db.ts) |
| App assembly, CORS, limits, static models | [src/app.ts](src/app.ts) |
| Admin authorization | [src/auth.ts](src/auth.ts) |
| HTTP input shape and response errors | [src/schemas.ts](src/schemas.ts), [src/http.ts](src/http.ts) |
| Product/order/upload handlers | [src/routes/](src/routes/) |
| Rich HTML sanitization / description images | [src/description.ts](src/description.ts), [src/routes/mediaFiles.ts](src/routes/mediaFiles.ts) |
| Checkout orchestration and authoritative totals | [src/orders.ts](src/orders.ts) |
| Local JSON/domain types and constants | [src/domain/types.ts](src/domain/types.ts), [src/domain/config.ts](src/domain/config.ts) |
| Pricing, sizing, normalization, validation, snapshots | [src/domain/utils/](src/domain/utils/) |
| API integration coverage | [src/api.test.ts](src/api.test.ts) |
| Runtime demo assets | [public/models/](public/models/) |

Keep handlers focused on HTTP/auth/persistence. Reuse local domain helpers for business
rules instead of creating a second pricing or normalization path.

## Rules that must remain true

- Parse untrusted input with Zod, then apply business validation. Keep the compile-time
  schema/type equivalence check. Use `HttpError`/`notFound` and the central error handler:
  `{ error, details? }`, appropriate status codes, safe client messages, logged unexpected
  failures. Do not turn errors into empty successful responses.
- Enforce admin permissions server-side for mutations, order reads and session checks.
  Public product reads exclude unpublished products. CORS is not authentication:
  preserve exact-origin allowlisting and upload preflights with Authorization,
  Content-Type and X-File-Name.
- Checkout accepts choices, not authoritative prices or manufacturing placement. Load
  current published products; normalize choices, validate dimensions/text, recompute
  prices and build snapshots from trusted product data. Do not accept client summaries,
  decoration layouts, timestamps, IDs or totals as authoritative.
- A selected multi-plate product is one set: sum volume; dimensions represent maximum
  extent per axis, not side-by-side display width. One scale applies to every plate.
  Quantity counts sets. Engraving, colored engraving and texture fees apply once per set;
  premium filament applies once per filament ID across bodies and lettering.
- Preserve legacy `mesh.plate`, absent `selectedPlates`, and root customization fallback
  when per-plate appearances are absent. New explicit selections must be nonempty,
  distinct and reference real plates.
- Keep measurements in mm and volume in cm3; reuse sizing helpers and existing cent
  rounding. Current dimension bounds are 5-270 mm, quantity 1-20; use constants rather
  than scattering these values.
- Orders retain readable per-plate appearance and deep-copied layout snapshots after
  products change. MongoDB `_id` stays internal; API IDs are strings. Preserve unique
  indexes and the bounded retry for order-number collisions.
- Model uploads use raw octet-stream bodies, URL-encoded filenames, a 50 MB limit and GridFS.
  JSON bodies have a 10 MB limit; each texture is a validated PNG/JPEG/WebP base64 data
  URL up to 3,000,000 characters. Do not weaken limits or claim full model parsing:
  upload detection is only a lightweight plausibility check.
- Descriptions are plain text unless `descriptionFormat: 'html'` is explicit. Sanitize
  rich HTML on mutations; never store arbitrary iframe markup or permit event handlers.
  `gallery` is carousel-only; inline media stay in the body and also join the carousel.
  Description images use a separate `mediaFiles` GridFS bucket, 10 MB raw uploads and
  detected PNG/JPEG/WebP/GIF MIME types. No SVG/video uploads. These public images persist
  immediately and are retained on cancel/removal/deletion because references may be shared.
- Replaced uploads get new immutable URLs. Duplicated products may share a file: use
  reference-aware cleanup, not unconditional deletion. Preserve stored relative URLs
  and idempotent migrations; never reseed a populated catalog as an incidental fix.

## Implementation and verification

Use strict TypeScript, `import type`, existing naming/formatting and `node:` built-ins.
Prefer typed guards to `any` or double casts. `null` is meaningful in the JSON contract;
do not globally replace it with `undefined`. Make narrow, complete changes, retain
unrelated edits, and update directly affected documentation.

For a bug, add a regression at the owning layer and run the smallest relevant test set,
then type-check. Changes to startup/auth/schemas/persistence should include API tests;
pricing or compatibility changes also need domain tests. Escalate to the full suite for
broad changes, not automatically for documentation edits.

API tests construct `createApp` with isolated `MongoMemoryServer` data; they do not need
the development API or a real database. The first run may need a MongoDB binary download.
Report download/environment failures rather than substituting production data or
disabling assertions. Verify failure paths, tampering, old records and exact totals,
not just successful HTTP status codes. State what was checked and any remaining limits.
