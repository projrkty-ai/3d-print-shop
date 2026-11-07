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
- `npm run db:seed`: seed an empty catalog and missing print options in the configured store;
  `npm run db:seed -- --reset` explicitly replaces demo products and the print options with the
  examples, not orders or print requests.

## Storage

`DATABASE` selects `sqlite` or `mongodb`. When unset, `npm run dev` and `npm run db:seed`
use SQLite, and `npm start` (production) uses MongoDB, so an existing deployment never
silently switches to an empty local file. Any other value fails on startup. The server logs
which store it uses.

- **SQLite**: `SQLITE_PATH` (default `data/printforge.sqlite`, relative to the working
  directory; git-ignored). The file and its directory are created on first start and the
  demo catalog is seeded. Products, orders and print requests are stored as JSON documents
  with indexed columns; uploaded models and images are BLOBs in the same file, so copying the file (with
  the server stopped) backs up everything. Uses WAL mode; intended for local development and
  single-process installations. Node prints no experimental warning because the npm scripts
  pass `--disable-warning=ExperimentalWarning`. A database written by a newer schema
  version is refused before any schema changes. Schema 4 combines `custom_orders`,
  `log_entries`, `project_orders`, `project_products` and `settings`. Databases from
  the original application and either feature version upgrade automatically, retaining
  existing documents and uploads. The search version's settings `id` column is renamed
  to `key`; print options, email templates and pricing remain separate documents.
  Older backend versions refuse the upgraded file.
- **MongoDB**: `MONGODB_URI` (default `mongodb://localhost:27017/printforge`); uploads
  use GridFS buckets `modelFiles`, `mediaFiles`, `customerFiles` and `mailFiles`; print requests are in the
  `customOrders` collection, log books in `logEntries`, and print options and email templates in
  `settings`; external orders and ready-to-print products use `projectOrders` and
  `projectProducts`. Legacy pricing settings are migrated from `{ id, ...rates }`
  to `{ key: 'pricing', value: rates }`, retaining print options and templates.
  Indexes are created on start. `docker compose up -d` starts a
  local server.

Both stores implement `src/storage/types.ts` and pass the same contract tests. Uploaded
file ids are 24 hex characters in both, so `/api/model-files/…` and `/api/media-files/…`
URLs look identical. Data is not migrated between stores.

## Configuration

`DATABASE`, `SQLITE_PATH`, `MONGODB_URI` (see above), `PORT` (3001), `ADMIN_TOKEN`,
`CORS_ORIGINS` (comma-separated exact HTTP(S) origins), the email settings (`SMTP_*`,
`MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_OUTBOX_DIR`; see *Log book and emails to customers*),
and `THINGIVERSE_TOKEN` / `MODEL_SEARCH_SOURCES`
(see [External model search](#external-model-search)). Production requires `ADMIN_TOKEN`; development generates a
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
| GET | `/settings/catalog-pricing` | Public current derived catalog rates per cm³ and once-per-order handling fee |
| POST | `/products` | Admin creates a product |
| PUT | `/products/:id` | Admin replaces editable product fields |
| DELETE | `/products/:id` | Admin deletes a product |
| POST | `/orders` | Customer checkout; server recalculates all prices |
| GET | `/orders` | Admin list; optional `status` filter |
| GET | `/orders/:id` | Admin order details |
| PATCH | `/orders/:id` | Admin changes status or internal note |
| DELETE | `/orders/:id` | Admin deletes an order |
| POST | `/custom-orders/files` | Customer binary STL/3MF upload for a print request, `X-File-Name` header |
| POST | `/custom-orders` | Customer confirms a print request; 409 lists uploads to send again |
| GET | `/custom-orders` | Admin list of print requests; optional `status` filter |
| GET | `/custom-orders/:id` | Admin print request details |
| PATCH | `/custom-orders/:id` | Admin review: status, quoted price, internal note |
| DELETE | `/custom-orders/:id` | Admin deletes a print request and its files |
| GET | `/custom-orders/:id/files/:fileId` | Admin download of one of the request's files |
| GET | `/print-settings` | Public nozzles, layer heights and filaments for print requests |
| PUT | `/print-settings` | Admin replaces the nozzles, layer heights and filaments |
| GET | `/orders/:id/log`, `/custom-orders/:id/log` | Admin log book, newest first |
| POST | `/orders/:id/email-preview` (and custom) | Admin: the status email for `{ status, note?, quotedPrice? }` |
| POST | `/orders/:id/messages` (and custom) | Admin sends `{ subject, body }` to the customer; 201 with the log entry |
| POST | `/orders/:id/log/eml` (and custom) | Admin imports a raw .eml file (15 MB) into the log book |
| GET | `/orders/:id/log/:entryId/eml` (and custom) | Admin download of an imported original |
| GET | `/email-templates` | Admin: status email templates, their variables and the defaults |
| PUT | `/email-templates` | Admin replaces `{ templates }` after checking required variables |
| GET | `/email-templates/delivery` | Admin: `{ transport: smtp | outbox | disabled, from }` |
| POST | `/model-files` | Admin binary STL/3MF upload, `X-File-Name` header |
| GET | `/model-files/:id` | Public model download |
| POST | `/media-files` | Admin binary PNG/JPEG/WebP/GIF upload (10 MB), also for shop textures |
| GET | `/media-files/:id` | Public description image or shop texture download |
| GET | `/model-search?q=&cursor=` | Public search of Thingiverse, Printables and MakerWorld (see below) |
| GET | `/model-search/project?url=` or `?source=&id=` | Public: an external project with its files |
| POST | `/project-orders` | Customer orders an external project (no price; the shop quotes) |
| GET | `/project-orders` | Admin list; optional `status` filter |
| GET | `/project-orders/:id` | Admin project order details |
| PATCH | `/project-orders/:id` | Admin changes status or internal note |
| PUT | `/project-orders/:id/review` | Admin prices an order that needs a quote (409 for fixed-price orders) |
| DELETE | `/project-orders/:id` | Admin deletes a project order |
| GET | `/settings/pricing` | Admin: hourly rate, handling fee, filament prices (defaults until saved) |
| PUT | `/settings/pricing` | Admin changes the shop-wide pricing rates |
| GET | `/project-products` | Published ready-to-print products with their current price; admins receive all, with measurements and breakdown |
| GET | `/project-products/:id` | Public if published; admin otherwise |
| POST | `/project-products` | Admin creates a ready-to-print product from a reviewed project order |
| PATCH | `/project-products/:id` | Admin changes title, description, publication or measurements |
| DELETE | `/project-products/:id` | Admin deletes a ready-to-print product |
| POST | `/project-products/:id/orders` | Customer orders sets of a published product (other materials: a quote request) |

The backend also serves its own bundled demo models at `/models/*`, including the demo shop
textures in `/models/textures/` (regenerate with `node scripts/generate-demo-textures.mjs`).
The seed catalog includes a two-plate set (**Star Vase Set**, `star-vase-project.3mf`) with
per-plate placement, and shop textures on it and the Spiral Vase. Existing databases are
only seeded when empty: use `npm run db:seed -- --reset` (SQLite: or delete `data/`) to get
the new examples. Neither storefront
nor administrator HTML is served by this process. Configure `CORS_ORIGINS` for both
independently hosted frontends; authorization/content-type/file-name preflights are
supported. Unconfigured browser origins receive 403.

## Print requests (customers' own models)

Customers can ask the shop to print their own STL/3MF files. Unlike catalog orders these have
no price when submitted: the shop reviews the files and then approves (usually with a quote)
or rejects the request. They are stored separately from orders, numbered `CP-YYMMDD-XXXX`.

1. The storefront uploads each file to `POST /custom-orders/files` (raw body, up to 50 MB,
   no admin key). The format is detected from the contents, stricter than the admin upload: a
   3MF must be a ZIP package with a 3D model part, a binary STL must be as long as its triangle
   count says, an ASCII STL must contain facets. A `.stl`/`.3mf` name that contradicts the
   contents is rejected; a missing extension is added. The response has a `fileId` and a
   secret `uploadKey`; only its SHA-256 hash is stored.
2. `POST /custom-orders` with `{ customer, files: [{ fileId, uploadKey, quantity, nozzleId,
   layerHeightId, parts: [{ key, name, filamentId, colorId }] }], customerNote? }` (1–10
   distinct files, 1–20 copies each, 1–16 distinct color parts per file, note up to 2,000
   characters) creates the request with status `submitted` and `quotedPrice: null`. The
   nozzle, layer height, filament and color of every part must be currently offered, and the
   layer height must suit the nozzle (otherwise 400 with per-file `details`; the storefront then
   reloads the options). The request stores a snapshot of the nozzle, layer height, filament
   names, prices per kilogram, densities and colors, so later changes don't alter it. Each upload is claimed atomically for that
   request, so a file can't be attached twice or by someone who doesn't hold its key. Unknown,
   expired, mismatched or already used uploads return 409 with per-file `details`; the
   storefront then uploads the files again automatically.

### Print options

`GET /print-settings` returns `{ nozzles, defaultNozzleId, layerHeights, defaultLayerHeightId,
filaments, updatedAt }`:

- `nozzles`: `{ id, diameterMm (0.1–2), priceMultiplier (>0–10) }`, distinct diameters.
- `layerHeights`: `{ id, heightMm (0.02–1.6), priceMultiplier (>0–10) }`, distinct heights. A
  layer height can be printed with a nozzle when it is **at least diameter / 4 and at most
  diameter × 0.8** (e.g. 0.10–0.32 mm for 0.4 mm); the frontends only offer those.
- `filaments`: `{ id, name, description, pricePerKg (> 0, USD per kilogram of printed
  filament), densityGPerCm3 (0.5–3), colors: [{ id, name, hex }] }`.

Admins replace the whole document with `PUT`. Ids must be unique (colors within their
filament); there must be at least one nozzle, layer height and filament with a color; every
nozzle must have at least one layer height in its range; and the default layer height must suit
the default nozzle. Up to 10 nozzles, 20 layer heights, 30 filaments and 40 colors per
filament. When missing, the server stores examples on start: nozzles 0.2 (×1.3), 0.4 (×1,
default), 0.6 (×0.9) and 0.8 mm (×0.85); layer heights 0.08 (×2), 0.12 (×1.5), 0.16 (×1.2),
0.20 (×1, default), 0.24 (×0.9), 0.28 (×0.8), 0.32 (×0.75), 0.40 (×0.7), 0.48 (×0.65) and
0.56 mm (×0.6); PLA $80/kg (8 colors), PETG $100/kg (5), Silk PLA $120/kg (3), TPU 95A
$160/kg (3). Seeding never overwrites saved options except with `db:seed -- --reset`. Options
saved in the first format (named qualities, prices per gram) are converted on start: prices
per gram × 1000 become prices per kilogram, and qualities become layer heights for a single
0.4 mm nozzle (heights it can't print are dropped). Requests placed in that format keep their
snapshot; the admin shows them without print options or estimate.

Color parts are keyed as the frontends read the file: a 3MF color or material key, or `model`
for files without colors. Both frontends estimate one copy as solid volume × share of each part
× density ÷ 1000 × price per kilogram × the nozzle's multiplier × the layer height's
multiplier, with each part's share taken from its surface area. Customers see only the
resulting prices, never weights or rates. The backend can't measure 3MF geometry, so it stores no estimate; the shop sets the final
`quotedPrice`.

Statuses: `submitted` (awaiting review), `approved`, `rejected`, `printing`, `shipped`,
`delivered`, `cancelled`. The admin `PATCH` accepts `status`, `adminNote` and `quotedPrice`
(USD, 0 or more, rounded to cents, or `null` to withdraw it); files and customer details are
fixed. The backend sends no emails: the shop contacts the customer with the quote.

Customer files live in their own private store (`customerFiles`), never under the public
`/api/model-files/…`; they are downloaded only through the admin endpoint, with
`Content-Disposition: attachment` and `Cache-Control: private, no-store`. Deleting a request
deletes its files. Uploads never confirmed as part of a request (the customer left the summary
step, or confirming failed) are deleted after 24 hours: the server checks on start and then
hourly. An upload can be confirmed for 23 hours, so cleanup never deletes a file while a
request is claiming it. Back up this store together with the requests. The upload endpoint is public like
checkout; put a rate limit in front of the API (e.g. at the reverse proxy) if abuse is a concern.

## Log book and emails to customers

Every catalog order and print request has a **log book** (`log_entries` table in SQLite,
`logEntries` collection in MongoDB), newest first, holding:

- `status` entries: the status an order was placed with (`from: null`) and every change made
  by `PATCH` (changes to other fields are not logged);
- `emailSent` entries: every email the shop sent — automated (`template`, e.g.
  `customOrder.approved`) or written by the admin (`template: null`) — with recipient, subject,
  text, `messageId` and `delivery`: `sent`, `outbox` (development) or `failed` with its error;
- `emailImported` entries: emails imported from .eml files (e.g. the customer's replies), parsed
  with mailparser: sender, recipients, subject, Date, Message-ID, the plain text (generated from
  the HTML part when there is none; any charset and transfer encoding, capped at 100,000
  characters) and attachment names and sizes. The original file is kept in the private
  `mailFiles` store for download. An email whose Message-ID is already in the log is refused
  (409); a sender other than the customer's address is accepted and flagged (`fromCustomer`).
  Files that aren't emails (no sender) are refused (400).

Deleting an order or print request deletes its log book and imported files.

**Status emails.** `PATCH /orders/:id` and `PATCH /custom-orders/:id` accept `notify: true` and
an optional `note`: when the status changes, the template for the new status is rendered and
sent to the customer after saving, and logged. Its required values are checked **before**
anything is saved (400 with details): e.g. approving a print request needs a quoted price
(which can be saved in the same request), and rejecting or cancelling needs a `note` explaining
why. A failed delivery never undoes the status change: it is logged with its error.
`POST …/email-preview` renders the same email for an unsaved form, with the template's
`required` variables and the `missing` ones. Messages are plain text (UTF-8); subjects are
single lines, so no header can be injected.

**Templates.** One per status of each order kind (13), editable with `PUT /email-templates`
and stored in the settings document `emailTemplates`; the defaults are stored on start (in
`APP_LANGUAGE`, English or Polish) and restored by `db:seed -- --reset`; templates for statuses
added later are filled in from the defaults. Variables are written `{{name}}`:

- all: `customerName`, `orderNumber`, `status` (localized), `orderDate`, `shopName`, `note`
  (the admin's message for that email; empty lines left by an empty note are removed);
- orders: `total`, `items` (one line per item); print requests: `quotedPrice`, `files` (one line
  per model with its nozzle, layer height and filaments).

Required variables — which every saved template must contain and which must have a value when
sending: `orderNumber` everywhere; also `total` (order pending), `files` (request submitted),
`quotedPrice` (request approved) and `note` (order or request cancelled, request rejected).
Unknown variables are refused.

**Delivery** (`src/mail/mailer.ts`, nodemailer):

- `SMTP_HOST` set: SMTP with `SMTP_PORT` (587, or 465 with `SMTP_SECURE=true` for TLS from the
  start), optional `SMTP_USER`/`SMTP_PASSWORD` (STARTTLS is then required, credentials are
  never sent unencrypted), `MAIL_FROM` (required, e.g. `PrintForge <shop@example.com>`) and
  optional `MAIL_REPLY_TO`. Message-IDs use the MAIL_FROM domain.
- No SMTP in development: each email is written as an .eml file to `MAIL_OUTBOX_DIR`
  (`data/outbox`, git-ignored) and logged as `outbox`, so the whole flow works locally.
- No SMTP in production: sending is logged as `failed` ("not configured").

The server logs which mode it uses on start. Only the admin sends emails; placing an order
never emails the customer automatically (the pending/submitted templates can be sent from the
admin), so the public checkout can't be used to send mail.
## External model search

`GET /api/model-search?q=<2–100 characters>[&cursor=…]` searches Thingiverse, Printables and MakerWorld in
parallel from the server (the sites do not allow browser cross-origin calls, and the Thingiverse
token must stay secret) and returns one shape for every site:

```json
{
  "query": "vase",
  "results": [{ "source": "printables", "id": "12345", "title": "…", "description": "plain text",
                "thumbnailUrl": "https://…", "url": "https://www.printables.com/model/12345-…", "author": "…" }],
  "sources": [{ "source": "thingiverse", "label": "Thingiverse", "status": "ok", "count": 12,
                "total": 1843, "hasMore": true,
                "searchUrl": "https://www.thingiverse.com/search?q=vase&type=things" }],
  "nextCursor": "eyJ0aGluZ2l2ZXJzZSI6eyJwYWdlIjoyfX0"
}
```

Each page has up to 12 results per site, interleaved (one from each site in turn). `count` is
the number in this page; `total` is the number of matches the site reports for the query (null
when it does not say) and `hasMore` whether the next page continues that site. To load more,
repeat the request with the same `q` and `cursor=<nextCursor>`; the next page contains only the
sites with more results (`sources` lists just those) and `nextCursor` is null at the end.
The cursor is opaque base64url JSON holding each site's own position (Thingiverse page number,
Printables cursor/offset, MakerWorld offset); it is strictly validated, and an invalid one
answers 400. A site that fails while loading more is left out of later pages. Each source reports
`ok`, `error` (failed or took over 12 s; details are logged, not returned) or `unconfigured`,
so one unavailable site never hides the others; `searchUrl` repeats the search on that site.
Descriptions are HTML/Markdown reduced to at most 280 characters of plain text. Links must be
HTTPS on the source's own domain and thumbnails HTTPS; NSFW-flagged models are dropped.
Successful answers are cached in memory for 10 minutes per site, query and page (Thingiverse
descriptions for 24 hours), which also limits traffic to the sites.

- **Thingiverse** uses the official REST API and needs `THINGIVERSE_TOKEN`, an App Token from
  <https://www.thingiverse.com/developers> (create an app). Without it Thingiverse is reported as
  `unconfigured`. Search hits carry no description, so it is read from each model (4 at a
  time); mind the API's rate limits.
- **Printables** and **MakerWorld** have no documented public API. The integration calls the
  same endpoints their websites use (Printables GraphQL `searchPrints2`, falling back to
  `searchPrints`; MakerWorld `search-service/select/design2`, falling back to `design`). These
  can change or block server traffic without notice; the source is then reported as `error`
  and the storefront links to the search on that site. Adapters are in `src/modelSearch/`.

`MODEL_SEARCH_SOURCES` (comma-separated, default all three) limits the searched sites; an
empty value disables the search. Unknown names fail on startup. Results belong to their
designers and carry their own licenses; the shop only links to the original pages.

### Project pages and project orders

`GET /api/model-search/project?url=<model page link>` (or `?source=&id=`) returns
`{ project, files, filesAvailable }`: the project (title, plain-text description, thumbnail,
author, license, link) and its printable files `{ id, name, sizeBytes, thumbnailUrl }`.
Links are recognized for all three sites (`thingiverse.com/thing:123`,
`printables.com/model/123-slug`, `makerworld.com/en/models/123`). Thingiverse uses
`GET /things/{id}` and `/things/{id}/files` (model files only; other files when there are
none); Printables the `print` GraphQL query with its `stls` list; MakerWorld the design
endpoint, offering its model files or, failing that, its print profiles. `filesAvailable` is
false when the site listed none. Answers are cached for 10 minutes. A link to another site
answers 400, a disabled source 404, and a site failure 502.

`POST /api/project-orders` records a customer's request to print such a project:

```json
{
  "customer": { "name": "…", "email": "…", "address": { "line1": "…", "city": "…", "postalCode": "…", "country": "…" } },
  "project": { "source": "printables", "id": "12345", "title": "…", "url": "https://www.printables.com/model/12345-…",
               "thumbnailUrl": null, "author": "…" },
  "items": [{ "file": { "id": "9", "name": "hook.stl" },
              "settings": { "quantity": 2, "scalePercent": 100,
                            "filaments": [{ "material": "PETG", "color": "black" }, { "material": "TPU", "color": "red" }] } }],
  "sameSettingsForAll": false,
  "notes": "No supports, please."
}
```

Each item is one model with its own print settings: quantity (1–20), scale (10–500 %) and
1–8 filaments (material `any|PLA|PETG|ABS|ASA|TPU|resin` plus a free-text color), several for
multi-color or multi-material prints. `file: null` orders the whole project and must be the
only item (for sites that list no files); a file may appear once. With
`sameSettingsForAll: true` every item must carry identical settings. The project URL must be
HTTPS on the source's own domain. The server fetches the project again (normally from the
cache) and stores the verified project and file details; if the site cannot be reached, the
customer's copy is stored and `projectVerified` is false so the admin checks the link before
quoting. Project orders saved by the first version (one `preferences` object for a list of
`files`) are upgraded on startup into one item per file sharing those settings. Project orders get `PJ-…` numbers, start
in status `new` (then `quoted`, `accepted`, `printing`, `shipped`, `cancelled`) and carry no
price: the shop quotes after reviewing. Admin endpoints mirror `/orders`. They are stored in
the `project_orders` table (SQLite, created automatically) or the `projectOrders`
collection (MongoDB).

### Dynamic catalog pricing

Catalog products use the current `/settings/pricing` hourly rate, per-kilogram material
rate and handling fee, not their legacy `basePrice` and `fixedFee`. The estimate is:

```text
weight (g) = scaled model volume (cm³) × 1.3 g/cm³ × 0.30
print time (h) = weight / 20 g/hour
print price = print time × hourly rate + weight / 1000 × material price per kg
order total = Σ (rounded print price + customization surcharges) × quantity + handling fee
```

This is a volume-based estimate, not a slicer quote: 30% is an approximation of printed
volume, including infill, and density/throughput are fixed across materials. Price changes
with the volume ratio when a customer changes size. Whole-word material matching recognizes
PLA (including PLA+), PETG, ABS, ASA, TPU and resin; other names use PLA. Product-specific
premium colors, engraving and picture-texture fees retain their existing rules.

Every product response includes API-derived `catalogPricing` (`ratesPerCm3`, `handlingFee`,
`updatedAt`). It is never persisted or trusted from an admin/customer payload.
`/settings/catalog-pricing` returns the same rates even with an empty catalog. New catalog
orders snapshot one `handlingFee` separately from their items; checkout always uses current
rates. Historical orders remain unchanged and may have no `handlingFee`.
There is no database migration or reseeding. Legacy base-price fields remain stored for
compatibility, but cannot override current catalog pricing.

### Pricing project orders

Every project price is calculated from **measurements** — print time and grams of filament per
material (`PLA|PETG|ABS|ASA|TPU|resin`) — with the shop-wide **rates**:

    price = handling fee + print time (h) × printer hourly rate + Σ grams / 1000 × price per kg

with every part rounded to cents (rows of one material are added up). The rates are edited in one
place (`PUT /api/settings/pricing`: `{ hourlyRate, handlingFee, filamentPricePerKg: { PLA, PETG,
ABS, ASA, TPU, resin } }`, amounts in USD, ≥ 0); until the admin saves them, `GET` answers defaults
with `updatedAt: null`.

**Ready-to-print products** store only the measurements of one set (`measurements`), never a
price: every response calculates it with the current rates, so a rate change reprices every
product at once. Admins receive `measurements` and the calculated `pricing` breakdown and can
change the measurements (`PATCH /api/project-products/:id` with `{ measurements }`); customers
receive only `price: { total, handlingFee, setPrice, currency }`. A product is created from a
reviewed project order (`POST /api/project-products` with `{ orderId, title, description,
published }`), taking its project, models, settings and the review's measurements.

**Orders** are the one exception: an order's price entry (`review`: measurements, rates used,
amounts and `total`) is calculated when it is set and then stored, and only orders that need a
quote (`requiresQuote: true`) may change it.
- `POST /api/project-products/:id/orders` with `{ customer, sets (1–20), notes, items? }` orders
  `sets` copies of a published product. `items` lists the customer's filaments for every model in
  the product's order (`[{ fileId, filaments: [{ material, color }] }]`, same models and number of
  filaments; omitted: as offered). **Colors** are free and keep the price: the order is priced at
  once from the product's measurements × `sets` with the current rates (handling fee once,
  `total = handlingFee + sets × setPrice`), `requiresQuote: false`, and the price is final — later
  rate changes do not touch it and `PUT …/review` answers 409. **Another material** makes it a
  project order that needs a quote: `requiresQuote: true`, no price yet,
  `product.materialsChanged: true`.
- Orders for projects found by search always need a quote. The admin prices them with
  `PUT /api/project-orders/:id/review` and `{ printMinutes, filaments: [{ material, grams }] }`
  (at least one, grams > 0) using the current rates; saving again reprices the quote.

Data from earlier versions is upgraded on startup: products' stored price snapshots become their
measurements, and orders without `requiresQuote` need a quote unless they were placed for a
ready-to-print product (which was always priced at once). SQLite keeps products and settings in
`project_products` and `settings` (schema version 3); MongoDB in `projectProducts` and `settings`.

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
applies to all plates. Catalog prices use the scaled solid volume estimate above, with
handling charged once per order. Premium
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
