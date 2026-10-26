# PrintForge backend

Standalone Express/MongoDB application. No React, Three.js, frontend source imports or
HTML hosting. All domain types, pricing and validation belong to this application in
`src/domain/`; they are not linked to either frontend.

Requires Node 22+ and MongoDB.

```bash
npm ci
cp .env.example .env
# Set a unique ADMIN_TOKEN; for example generate it with:
# node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
docker compose up -d
npm run dev
```

- `npm test`: API integration tests using in-memory MongoDB, plus domain unit tests.
- `npm run build` / `npm run typecheck`: check the standalone server and tests.
- `npm start`: production server, running TypeScript with the declared `tsx` dependency.
- `npm run db:seed`: seed an empty catalog; `npm run db:seed -- --reset` explicitly
  replaces demo products, not orders.

Configuration: `MONGODB_URI`, `PORT` (3001), `ADMIN_TOKEN` and `CORS_ORIGINS` (comma-separated
exact HTTP(S) origins). Production requires `ADMIN_TOKEN`; development generates a
temporary key if omitted. Never expose the key in frontend build variables. The included
Compose project retains the original development MongoDB volume. Existing products,
GridFS models and orders require no migration beyond the existing automatic migrations.

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
| POST | `/media-files` | Admin binary PNG/JPEG/WebP/GIF upload (10 MB) |
| GET | `/media-files/:id` | Public description image download |

The backend also serves its own bundled demo models at `/models/*`. Neither storefront
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
in the `mediaFiles` GridFS bucket. SVG and video uploads are rejected. Images are public,
not private attachments. Uploads persist immediately, including when product editing is
cancelled. They are retained when removed from descriptions or when products are deleted:
duplicated products and other descriptions may reference the same image. Back up this
bucket and account for retained/orphaned uploads when managing storage.

## Manufacturing and pricing

One product may include multiple selected 3MF plates. Quantities count complete sets.
Volume is summed; base dimensions use the maximum extent on each axis and one scale
applies to all plates. The price includes the fixed fee and scaled solid volume. Premium
filament surcharges apply once per filament across the set; engraving, colored engraving
and picture texture fees each apply once per set.

Checkout normalizes current color/font/plate choices, validates dimensions and text,
and snapshots each plate's appearance plus administrator-owned text/texture layout.
Customer-supplied placement and prices are never authoritative. The API accepts texture
PNG/JPEG/WebP data URLs up to 3,000,000 characters each, with a 10 MB JSON request limit.
Model uploads are limited to 50 MB. GridFS files are released only when no product refers
to them, so duplicated products can reuse an upload.

Before production, use HTTPS, a strong admin key, request/rate limits and backups.
Keep uploads and customer details private where appropriate; add a payment provider if
needed (checkout currently records an order without collecting online payment).
