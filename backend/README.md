# PrintForge backend

Standalone Express application storing data in SQLite (local development) or MongoDB
(production). No React, Three.js, frontend source imports or HTML hosting. All domain types,
pricing and validation belong to this application in `src/domain/`; they are not linked to
either frontend.

Requires Node 22.13+ (for the built-in `node:sqlite`). MongoDB is optional locally.

```bash
npm ci
cp .env.example .env
# Set a unique ADMIN_TOKEN; for example generate it with:
# node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
npm run dev
```

To run the storefront and administration as well, use `node scripts/start-local.mjs`
from the repository root.

- `npm test`: domain unit tests, plus the API, localization and storage tests against both
  stores (in-memory SQLite and in-memory MongoDB, which downloads a MongoDB binary once).
- `npm run test:sqlite`: the same without the MongoDB run; works offline.
- `npm run build` / `npm run typecheck`: check the standalone server and tests.
- `npm start`: production server, running TypeScript with the declared `tsx` dependency.
- `npm run db:seed`: seed an empty catalog in the configured store; `npm run db:seed --
  --reset` explicitly replaces demo products, not orders.

## Storage

`DATABASE` selects `sqlite` or `mongodb`. When unset, `npm run dev` and `npm run db:seed`
use SQLite, and `npm start` (production) uses MongoDB, so an existing deployment never
silently switches to an empty local file. Any other value fails on startup. The server logs
which store it uses.

- **SQLite**: `SQLITE_PATH` (default `data/printforge.sqlite`, relative to the working
  directory; git-ignored). The file and its directory are created on first start and the
  demo catalog is seeded. Products and orders are stored as JSON documents with indexed
  columns; uploaded models and images are BLOBs in the same file, so copying the file (with
  the server stopped) backs up everything. Uses WAL mode; intended for local development and
  single-process installations. Node prints no experimental warning because the npm scripts
  pass `--disable-warning=ExperimentalWarning`. A database written by a newer schema
  version is refused rather than modified.
- **MongoDB**: `MONGODB_URI` (default `mongodb://localhost:27017/printforge`); uploads
  use GridFS buckets `modelFiles` and `mediaFiles`. `docker compose up -d` starts a local
  server.

Both stores implement `src/storage/types.ts` and pass the same contract tests. Uploaded
file ids are 24 hex characters in both, so `/api/model-files/…` and `/api/media-files/…`
URLs look identical. Data is not migrated between stores.

## Configuration

`DATABASE`, `SQLITE_PATH`, `MONGODB_URI` (see above), `PORT` (3001), `ADMIN_TOKEN` and
`CORS_ORIGINS` (comma-separated exact HTTP(S) origins). Production requires `ADMIN_TOKEN`; development generates a
temporary key if omitted. Never expose the key in frontend build variables. The included
Compose project retains the original development MongoDB volume. Existing products,
GridFS models and orders in MongoDB require no migration beyond the existing automatic
migrations.

`APP_LANGUAGE` selects static API/validation messages, Zod's built-in messages, number
formatting and labels in newly created order snapshots: `en` (default when unset) or
`pl`. Any other value fails on startup. The supplied `.env.example` enables Polish.
Restart the backend after changing this setting. Currency remains USD. Product names,
descriptions, color/plate names and customer content are never translated; existing
orders retain their original snapshots. No migration or reseeding is required.
Tests explicitly select English regardless of application configuration, and localization
tests exercise both languages.

## HTTP API

All endpoints are under `/api`. Errors are JSON `{ "error": "...", "details": [] }`.
Admin requests use `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Access / behavior |
|---|---|---|
| GET | `/health` | Public health check |
| GET | `/admin/session` | Admin key check, 204 on success |
| GET | `/products` | Published products; authenticated admins receive all |
| GET | `/products/:id` | Public if published; admin otherwise |
| POST | `/products` | Admin creates a product |
| PUT | `/products/:id` | Admin replaces editable product fields |
| DELETE | `/products/:id` | Admin deletes a product |
| POST | `/orders` | Customer checkout; server recalculates all prices |
| GET | `/orders` | Admin list; optional `status` filter |
| GET | `/orders/:id` | Admin order details |
| PATCH | `/orders/:id` | Admin changes status or internal note |
| DELETE | `/orders/:id` | Admin deletes an order |
| POST | `/model-files` | Admin binary STL/3MF upload, `X-File-Name` header |
| GET | `/model-files/:id` | Public model download |
| POST | `/media-files` | Admin binary PNG/JPEG/WebP/GIF upload (10 MB), also for shop textures |
| GET | `/media-files/:id` | Public description image or shop texture download |

The backend also serves its own bundled demo models at `/models/*`, including the demo shop
textures in `/models/textures/` (regenerate with `node scripts/generate-demo-textures.mjs`).
The seed catalog includes a two-plate set (**Star Vase Set**, `star-vase-project.3mf`) with
per-plate placement, and shop textures on it and the Spiral Vase. Existing databases are
only seeded when empty: use `npm run db:seed -- --reset` (SQLite: or delete `data/`) to get
the new examples. Neither storefront
nor administrator HTML is served by this process. Configure `CORS_ORIGINS` for both
independently hosted frontends; authorization/content-type/file-name preflights are
supported. Unconfigured browser origins receive 403.

## Rich product descriptions

`descriptionFormat: "html"` opts into sanitized HTML descriptions (maximum 100,000
characters). Without this field, `description` remains legacy plain text. Basic formatting,
links, images and videos are allowed; scripts, inline styles, event handlers and arbitrary
iframes are removed. Videos store URLs, not iframe markup. Frontends create allowlisted
YouTube/Vimeo embeds; direct MP4/WebM links use native video controls.

Optional `gallery` contains up to 50 `{ type: "image" | "video", url, alt }` entries shown
only in the carousel. Inline description media also appear in the carousel while remaining
in their original description positions. Both frontends own independent rendering helpers.

Image uploads use `application/octet-stream`, validate the file signature and store data
in the `mediaFiles` bucket (GridFS in MongoDB, a BLOB table in SQLite). SVG and video
uploads are rejected. Images are public, not private attachments. Uploads persist immediately, including when product editing is
cancelled. They are retained when removed from descriptions or when products are deleted:
duplicated products and other descriptions may reference the same image. Back up this
bucket and account for retained/orphaned uploads when managing storage.

## Manufacturing and pricing

One product may include multiple selected 3MF plates. Quantities count complete sets.
Volume is summed; base dimensions use the maximum extent on each axis and one scale
applies to all plates. The price includes the fixed fee and scaled solid volume. Premium
filament surcharges apply once per filament across the set; engraving, colored engraving
and picture texture fees each apply once per set.

## 3D lettering

A decoration layout (product- or plate-level) may carry `extrudedText`: raised 3D text at a
fixed point of the printed model. The shop owns the placement — anchor `x`/`y`/`z` in
millimeters from the center of the model's footprint (X right, Y toward the back, Z up, each
within ±500), facing direction (`rotationDeg` −360…360 around the vertical axis, `tiltDeg`
0…90 toward lying flat), `sizeMm` (1–100), `depthMm` (0.2–20), `lineSpacing` (0.8–3),
alignments and `defaultText`. Customers may send `extrudedText` (replacement text; an empty
string removes the lettering) and `extrudedSizeMm`, clamped to 50–200% of the shop's size;
both are kept only when they differ from the suggestion. Text is limited to 60 characters
on up to 3 lines of Latin letters (including European accents), digits and basic
punctuation — the character set of the bundled 3D font. Invalid text rejects checkout; the
placement is snapshotted into the order like the rest of the layout. Lettering is free of
charge. The seed catalog places one on the Keepsake Box lid.

## Picture textures

`texture` is `{ enabled, price, options?, allowCustom? }`. `options` (up to 50) is the shop
texture library: `{ id, name, url }`, where `url` must be a site path on this API (normally
an upload to `POST /media-files`), since previews draw it on a WebGL canvas. `allowCustom:
false` disables customer uploads; omitting either field keeps the previous behavior
(uploads only). An enabled texture needs at least one library texture or allowed uploads.
Ids must be unique. No migration is needed.

Each surface's customization may carry `textureId` (a library texture) or `textureDataUrl`
(the customer's picture); a library texture wins if both are sent. The texture fee is
charged once per set either way; the price line's note names the library textures used.
Orders snapshot each appearance's `texture` as `{ source: "library", id, name, url }` or
`{ source: "custom" }`, so order pages stay correct after the library changes. Checkout
rejects a `textureId` the product no longer offers, and a customer picture the product no
longer accepts, instead of silently printing without the texture. Media files referenced
by orders are never deleted.

Checkout normalizes current color/font/plate choices, validates dimensions and text,
and snapshots each plate's appearance plus administrator-owned text/texture layout.
Part color snapshots (`parts[]`) include the file part `key` (older orders lack it), so
admin views can redraw the ordered colors on the model.
Customer-supplied placement and prices are never authoritative. The API accepts texture
PNG/JPEG/WebP data URLs up to 3,000,000 characters each, with a 10 MB JSON request limit.
Model uploads are limited to 50 MB. Uploaded model files are released only when no
product refers to them, so duplicated products can reuse an upload.

Before production, use HTTPS, a strong admin key, request/rate limits and backups.
Keep uploads and customer details private where appropriate; add a payment provider if
needed (checkout currently records an order without collecting online payment).
