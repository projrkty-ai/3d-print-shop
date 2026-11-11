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
  examples, not orders.

## Storage

`DATABASE` selects `sqlite` or `mongodb`. When unset, `npm run dev` and `npm run db:seed`
use SQLite, and `npm start` (production) uses MongoDB, so an existing deployment never
silently switches to an empty local file. Any other value fails on startup. The server logs
which store it uses.

- **SQLite**: `SQLITE_PATH` (default `data/printforge.sqlite`, relative to the working
  directory; git-ignored). The file and its directory are created on first start and the
  demo catalog is seeded. Products and orders are stored as JSON documents
  with indexed columns; uploaded models and images are BLOBs in the same file, so copying the file (with
  the server stopped) backs up everything. Uses WAL mode; intended for local development and
  single-process installations. Node prints no experimental warning because the npm scripts
  pass `--disable-warning=ExperimentalWarning`. A database written by a newer schema
  version is refused before any schema changes. Schema 4 combines `custom_orders`,
  `log_entries`, `project_orders`, `project_products` and `settings`. Databases from
  the original application and either feature version upgrade automatically, retaining
  existing documents and uploads. The search version's settings `id` column is renamed
  to `key`; print options, email templates and pricing remain separate documents.
  Schema 5 adds the `printers` and `printer_models` tables (the printers warehouse); the
  models' profile archives are BLOBs in the `printerFiles` bucket of `files`.
  Schema 6 keeps every order in `orders`, with an indexed `source` column: print requests
  (`custom_orders`) and project orders (`project_orders`) are converted into orders and their
  tables dropped (see *Orders of earlier versions*).
  Older backend versions refuse the upgraded file.
- **MongoDB**: `MONGODB_URI` (default `mongodb://localhost:27017/printforge`); uploads
  use GridFS buckets `modelFiles`, `mediaFiles`, `customerFiles`, `mailFiles` and `printerFiles`; every order is in
  the `orders` collection (indexed by number, status and source), log books in `logEntries`, and
  print options and email templates in `settings`; Print on Demand products use
  `projectProducts`. The `customOrders` and `projectOrders` collections of earlier versions are
  converted into orders on start and dropped. The printers warehouse uses the `printers` and `printerModels`
  collections (each with a unique index on `nameKey`, the lowercased name, which is never returned). Legacy pricing settings are migrated from `{ id, ...rates }`
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
and `THINGIVERSE_TOKEN` / `MODEL_SEARCH_SOURCES` / `MAKERWORLD_TOKEN`
(see [External model search](#external-model-search) and *Project files for printing*). Production requires `ADMIN_TOKEN`; development generates a
temporary key if omitted. Never expose the key in frontend build variables. The included
Compose project retains the original development MongoDB volume. Existing products,
GridFS models and orders in MongoDB require no migration beyond the existing automatic
migrations.

`TZ` (e.g. `Europe/Warsaw`) sets the time zone of the print times in status emails; Node uses the
system's time zone when it is unset.

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
| GET | `/settings/catalog-pricing` | Public current derived catalog rates per cm³ and once-per-order handling fee; admins also receive the hourly rate and filament prices |
| POST | `/products` | Admin creates a product |
| PUT | `/products/:id` | Admin replaces editable product fields |
| DELETE | `/products/:id` | Admin deletes a product |
| POST | `/orders` | Customer places an order of any `source` (catalog, upload, project, printOnDemand); the server calculates all prices |
| GET | `/orders` | Admin list, newest first; optional `status`, `source` and `limit` filters |
| GET | `/orders/:id` | Admin order details |
| PATCH | `/orders/:id` | Admin processing: status, internal note, price of an order that needs a quote, the printer's queue (`queued`), optional status email |
| DELETE | `/orders/:id/print-job` | Admin takes the order out of its printer's queue, back to its status before queueing |
| DELETE | `/orders/:id` | Admin deletes an order with its log book and uploaded files |
| PUT | `/orders/:id/items/:index/review` | Admin stores the shop's measurements of one copy of an item (priced with the current rates) |
| GET | `/orders/:id/project-files/:sourceFileId` | Admin download of one of the order's external project files, fetched from the project's site now (no copy is kept) |
| GET | `/orders/:id/files/:fileId` | Admin download of a model file the customer uploaded for the order |
| POST | `/uploads` | Customer binary STL/3MF upload for an order, `X-File-Name` header |
| POST | `/uploads/estimate` | Customer: prices the browser's slicing of uploaded models before ordering |
| GET | `/print-settings` | Public slicing profiles and filaments for uploaded models |
| PUT | `/print-settings` | Admin replaces the slicing profiles and filaments (and legacy nozzles/layer heights) |
| GET | `/orders/:id/log` | Admin log book, newest first |
| POST | `/orders/:id/email-preview` | Admin: the status email for `{ status, note?, price? }` |
| POST | `/orders/:id/messages` | Admin sends `{ subject, body }` to the customer; 201 with the log entry |
| POST | `/orders/:id/log/eml` | Admin imports a raw .eml file (15 MB) into the log book |
| GET | `/orders/:id/log/:entryId/eml` | Admin download of an imported original |
| GET | `/email-templates` | Admin: status email templates, their variables and the defaults |
| PUT | `/email-templates` | Admin replaces `{ templates }` after checking required variables |
| GET | `/email-templates/delivery` | Admin: `{ transport: smtp | outbox | disabled, from }` |
| POST | `/model-files` | Admin binary STL/3MF upload, `X-File-Name` header |
| GET | `/model-files/:id` | Public model download |
| POST | `/media-files` | Admin binary PNG/JPEG/WebP/GIF upload (10 MB), also for shop textures |
| GET | `/media-files/:id` | Public description image or shop texture download |
| GET | `/model-search?q=&cursor=` | Public search of Thingiverse, Printables and MakerWorld (see below) |
| GET | `/model-search/project?url=` or `?source=&id=` | Public: an external project with its files |
| GET | `/settings/pricing` | Admin: hourly rate, handling fee, filament prices (defaults until saved) |
| PUT | `/settings/pricing` | Admin changes the shop-wide pricing rates |
| GET | `/project-products` | Published Print on Demand products with their current price (and print options when sliced); admins receive all, with measurements, print setup and breakdown |
| GET | `/project-products/:id` | Public if published; admin otherwise |
| POST | `/project-products` | Admin creates a Print on Demand product from a project order with every model measured |
| PATCH | `/project-products/:id` | Admin changes title, description, publication, measurements, print file, scaling or print variants |
| DELETE | `/project-products/:id` | Admin deletes a Print on Demand product (and its unused print file) |
| POST | `/project-products/:id/quote` | Price of `sets` sets with the chosen print variants and scale, before ordering |
| GET | `/printers` | Admin: the printers in the workshop, sorted by name, each with its model |
| GET | `/printers/:id` | Admin printer details with its model |
| POST | `/printers` | Admin adds a printer of an existing model (409 when the name is taken) |
| PUT | `/printers/:id` | Admin changes a printer's name, model, location or notes |
| GET | `/printers/:id/queue` | Admin: the printer's queue with estimated start and end of every order |
| DELETE | `/printers/:id` | Admin deletes a printer (409 while orders are in its queue) |
| GET | `/printer-models` | Admin: the printer models, sorted by name, each with its printers |
| GET | `/printer-models/templates` | Admin: known printers a new model can start from |
| GET | `/printer-models/:id` | Admin printer model details |
| POST | `/printer-models` | Admin adds a printer model (409 when the name is taken) |
| PUT | `/printer-models/:id` | Admin changes a model's name, manufacturer, plate size or colors, for all its printers; profiles are kept |
| DELETE | `/printer-models/:id` | Admin deletes an unused model and its profile archive (409 while printers use it) |
| POST | `/printer-models/:id/profiles` | Admin binary ZIP upload (20 MB) of the model's slicer profiles, `X-File-Name` header; replaces the previous archive |
| GET | `/printer-models/:id/profiles` | Admin download of the profile archive (`Content-Disposition: attachment`) |
| DELETE | `/printer-models/:id/profiles` | Admin removes the profile archive |
| POST | `/custom-orders/files`, `/custom-orders/estimate`, `/custom-orders`, `/project-orders`, `/project-products/:id/orders` | Deprecated: where storefronts of earlier versions place orders (see *Orders of earlier versions*) |

The backend also serves its own bundled demo models at `/models/*`, including the demo shop
textures in `/models/textures/` (regenerate with `node scripts/generate-demo-textures.mjs`).
The seed catalog includes a two-plate set (**Star Vase Set**, `star-vase-project.3mf`) with
per-plate placement and two sliced print variants per plate at 60%, 100% and 140% (see *Sliced
print variants*), and shop textures on it and the Spiral Vase. Seed products are scalable within
a range (e.g. 50–140%) except the Keepsake Box, which is sold at its original size only. Existing databases are
only seeded when empty: use `npm run db:seed -- --reset` (SQLite: or delete `data/`) to get
the new examples. Neither storefront
nor administrator HTML is served by this process. Configure `CORS_ORIGINS` for both
independently hosted frontends; authorization/content-type/file-name preflights are
supported. Unconfigured browser origins receive 403.

## Orders

Every order is the same kind of document with the same lifecycle, price rules, measurements,
log book, status emails and admin endpoints, whatever its models are. Only the **source** of the
models differs, and with it what an item's `model` holds and how the price is known:

| `source` | Models | Number | Price (`price.mode`) |
|---|---|---|---|
| `catalog` | configured catalog products | `PF-YYMMDD-XXXX` | `fixed` when ordering |
| `upload` | the customer's own STL/3MF files | `CP-YYMMDD-XXXX` | `quote` (the customer sees an estimate) |
| `project` | models of a Thingiverse, Printables or MakerWorld project | `PJ-YYMMDD-XXXX` | `quote` |
| `printOnDemand` | sets of a Print on Demand product | `PJ-YYMMDD-XXXX` | `fixed`; `quote` when the customer chose other materials |

```jsonc
{
  "id": "…", "number": "CP-261018-K7QX", "status": "received", "source": "upload",
  "customer": { "name": "…", "email": "…", "phone": "…", "address": { "line1": "…", "city": "…", "postalCode": "…", "country": "…" } },
  "customerNote": "Matte side up, please.",
  "items": [{
    "model": { "source": "upload", "fileId": "…", "fileName": "vase.stl", "…": "…" },  // by source, see below
    "quantity": 2,
    "unitPrice": null, "lineTotal": null,   // set on fixed-price orders
    "estimate": { "printMinutes": 95, "filaments": [{ "key": "model", "grams": 31.2 }], "unitPrice": 10.5 },
    "review": { "printMinutes": 101, "hourlyRate": 3, "printTimeCost": 5.05,
                "filaments": [{ "key": "model", "label": "PLA Black", "grams": 33, "pricePerKg": 80, "cost": 2.64 }],
                "filamentCost": 2.64, "unitPrice": 7.69, "reviewedAt": "…" }
  }],
  "project": { "…": "…" },                  // project and Print on Demand orders only
  "price": { "mode": "quote", "handlingFee": 5, "estimated": 26, "reviewed": 20.38, "total": null },
  "currency": "USD", "adminNote": "", "createdAt": "…", "updatedAt": "…"
}
```

**Item models** (`items[].model`, told apart by `model.source`):

- `catalog`: the product snapshot checkout has always stored — `productId`, `productName`,
  `customization`, size and color labels, engraving color, decoration layout, texture, part colors,
  plates with their appearance and print variant — plus its `priceLines`.
- `upload`: `fileId` (private customer-file store), `fileName`, `format` (detected from the
  contents), `sizeBytes`, the customer's slicing `profile` and `parts` (color part → filament and
  color snapshot with the price per kilogram at the time). Uploads ordered before slicing profiles
  have `nozzle`/`layerHeight` instead, and the oldest neither.
- `project`: `file` (`{ id, name, sizeBytes, thumbnailUrl }`, or `null` for the whole project),
  `scalePercent` and `filaments` (`[{ material, color }]`). The order's `project` holds the project
  (`source`, `id`, `title`, `url`, `author`, …) with `verified` and `sameSettingsForAll`.
- `printOnDemand`: one set of a product — `productId`, `title`, `models` (the product's models,
  each with its copies per set, scale and filaments), `print` (sliced products: the scale and every
  plate's print variant with its presets) and `materialsChanged`. The item's `quantity` is the
  number of sets; `project` is the product's project.

**Placing an order.** `POST /api/orders` with `{ source, customer, customerNote?, … }` (note up to
2,000 characters) and the source's fields; a body without `source` is a catalog order, as sent by
earlier storefronts:

- `catalog`: `items: [{ productId, customization, quantity }]` (see *Manufacturing and pricing*);
- `upload`: `items: [{ fileId, uploadKey, quantity, profile, estimate?, parts }]` (see
  *Uploaded models* below);
- `project`: `project`, `items: [{ file, settings }]`, `sameSettingsForAll` (see *Project pages
  and project orders*);
- `printOnDemand`: `productId`, `sets`, `items?`, `print?` (see *Pricing project orders*).

The server calculates every price. Each order starts in status `received` with its number (drawn
again on the rare collision); its log book starts with that status. The answer is 201 with the
order and `Location: /api/orders/:id`.

**Statuses**, shared by every source: `received` → `quoted` → `accepted` → `paid` → `queued`
("In queue": waiting in a printer's queue) → `printing` → `done` (printed) → `shipped` →
`delivered`, or `rejected` / `cancelled`. Fixed-price orders normally skip `quoted` and
`accepted`. The admin may set any status; an order can only be `quoted` once it has a price (400
"Set the price before marking the order as quoted."), and `queued` needs a printer (see *Print
queues*).

**Price** (`price`, in `currency`):

- `fixed`: `total` = handling fee + Σ `lineTotal` (`unitPrice` × `quantity`), calculated when
  ordering. It never changes: later rate changes don't touch it, and `PATCH` with another `price`
  answers 409.
- `quote`: `total` is `null` until the shop sets it with `PATCH /api/orders/:id { price }` (USD,
  0 or more, rounded to cents; `null` withdraws it). Two helpers: `estimated`, the customer's own
  estimate (uploads: Σ `estimate.unitPrice` × copies + handling) and `reviewed`, the shop's
  measurements of every item with the rates at the time (handling included). The admin decides
  what to quote.

**Measurements** (the shop's slicing, for every source). `PUT /api/orders/:id/items/:index/review`
(`index` in `items`) with `{ printMinutes, filaments: [{ key, grams }], sliced? }` stores the
measurements of one copy — one set for Print on Demand — priced with the current rates as the
item's `review` (print time × hourly rate + grams × price per kilogram, each rounded to cents;
rows with the same key are added up). `sliced` keeps the slicer's unedited result with `slicedAt`
when the admin adjusted it. The filament `key` depends on the source:

- `upload`: a color part of the model (`filament:N`, a material key or `model`), priced with the
  filament the customer chose for it at its price when ordering;
- other sources: a material `PLA|PETG|ABS|ASA|TPU|resin` at the current price per kilogram.

An unknown key is a 400 naming it. Once every item is measured, `price.reviewed` is set; quote
orders also take the current handling fee. On fixed-price orders the measurements only plan the
print; the price stays. Saving again replaces an item's measurements.

**Processing.** `PATCH /api/orders/:id` accepts `status`, `adminNote` (up to 5,000 characters),
`price` (quote orders), `queue` (with status `queued`, see *Print queues*) and, with a status change,
`notify` and `note` (see *Log book and emails to customers*). Items, customer details and the source
are fixed once ordered. `DELETE` removes the
order, its log book and its uploaded files. `GET /api/orders` lists the newest first and filters by
`status`, `source` and `limit` (up to 500).

### Print queues

Every printer of the warehouse has a queue. An order joins it by changing to `queued` ("In queue")
with the printer: `PATCH /api/orders/:id` with `{ status: "queued", queue: { printerId, printMinutes? },
notify? }`. `printMinutes` is how long the whole order prints (whole minutes, 1 to 60 days); without
it, the shop's measurements are used (Σ one copy's print time × copies, every item measured; 400
"Enter how long the order prints: not every item is measured." otherwise). The order goes to the end
of that printer's queue and gets `printJob`:

```json
{ "printerId": "…", "printerName": "U1-01", "queuedAt": "…", "printMinutes": 150, "startedAt": null,
  "estimatedStart": "2026-11-10T15:00:00.000Z", "previousStatus": "paid" }
```

- **Order and estimates.** A printer prints its queue in the order the orders joined, one order at a
  time, with a break of 1 hour (`QUEUE_GAP_MINUTES`) between two prints. The order being printed
  comes first: it ends `printMinutes` after `startedAt` (or now, when it takes longer); each waiting
  order starts an hour after the previous one ends, the first one of an idle printer now.
  `estimatedStart` is the estimate when the order joined (what the customer was told).
- **Email.** The `queued` status email states `{{printStart}}` (the estimated start),
  `{{printDuration}}` (the print time, e.g. "2 h 30 min") and `{{printEnd}}` (start + print time),
  in the server's time zone (`TZ`) with its name. `POST /api/orders/:id/email-preview` accepts the
  same `queue` to show the estimate before saving; without a printer these values are missing.
- **Printing and done.** `printing` starts the order's print (`startedAt`); a printer prints one
  order at a time (409 "U1-01 is already printing order …" otherwise). Going back to `queued` keeps
  the order's place. `done` (printed) — like any status other than `queued` and `printing`, e.g.
  `cancelled` or `rejected` — takes the order out of its queue (`printJob: null`), and the orders
  behind it move up.
- **Moving and removing.** `queued` with another printer moves the order to the end of that printer's
  queue (keeping its print time unless the order was measured since), with a new estimate and email;
  the same printer without a new print time keeps its place. `DELETE /api/orders/:id/print-job`
  (admin, `?notify=true` to email) takes the order out of its queue: it gets back `previousStatus`,
  the status it had before queueing, logged like any status change.
- **The queue.** `GET /api/printers/:id/queue` (admin) answers `{ printer, entries, gapMinutes }`:
  `entries` in printing order, each with `position`, the order (`id`, `number`, `status`, `source`,
  `createdAt`, `customerName`, `models`, e.g. "2 × Spiral Vase"), its `printJob` and the current
  `estimatedStart` and `estimatedEnd`. Every printer response has `queue: { length, nextStart }`
  (when an order queued now would start). A printer with orders in its queue can't be deleted (409
  listing them).

Queues are not stored separately: they are the orders with `printJob` (statuses `queued` and
`printing`), so no migration is needed.

### Project files for printing

Project and Print on Demand orders print files of an external project: the models the customer
chose, or the models of the ordered product's set. The shop doesn't store them: they are
downloaded from the project's site whenever the admin needs them, to slice them for a quote or to
save them for printing.

`GET /api/orders/:id/project-files/:sourceFileId` (admin; `sourceFileId` is the file's id on the
site, as in the order's models) loads the project page again (normally from the 10-minute cache),
checks that it still lists the file, downloads the file from the site (up to 200 MB, three minutes)
and passes it on: `Content-Type: application/octet-stream`, `Content-Disposition: attachment` with
the site's file name (an extension is added to STL/3MF files that lack one), `Cache-Control:
private, no-store` and `X-Model-Format`: `stl`, `3mf` or `other` (e.g. STEP, which can be saved
but not sliced in the browser). Nothing is kept on the server, and the order doesn't change: every
request downloads the file again. Frontends on another origin can read `Content-Disposition` and
`X-Model-Format` (exposed by CORS). Errors: 404 for a file the order doesn't print (whole-project
items have no files); 503 when the site is disabled or not configured; 409 when the site no longer
lists the file; 502 when the download fails or the file is too large (the site's error is in
`details`). The admin can always download a file from the project page instead.

How each site is downloaded from (`downloadFile` of the adapters in `src/modelSearch/`):

- **Thingiverse**: `GET https://api.thingiverse.com/files/{id}/download` with the app token
  (`THINGIVERSE_TOKEN`), which redirects to the file.
- **Printables**: the website's GraphQL mutation `getDownloadLink` (file type `stl`, which includes
  3MF) gives a short-lived link on `printables.com`, which is then downloaded.
- **MakerWorld** lists print profiles; `GET /api/v1/design-service/instance/{id}/f3mf?type=download`
  answers the profile's 3MF name and a link on MakerWorld's storage (`bblmw.com`). MakerWorld lets
  only signed-in users download: set `MAKERWORLD_TOKEN` to the `token` cookie of a signed-in
  makerworld.com session (keep it secret; it expires and must then be replaced). Without it these
  downloads fail with a message saying so.

Links from the sites' answers are followed only over HTTPS on the site's own domains. Printables and
MakerWorld downloads use undocumented endpoints of their websites, which may change without notice;
a failed download is reported to the admin with the reason, and the file can still be downloaded from
the project page.

### Uploaded models

Customers can order prints of their own STL/3MF files. The customer's browser slices every model
with one slicing profile to show an **estimated** price; the shop slices it again with exactly that
profile (see *Measurements*), then quotes or rejects the order.

1. The storefront uploads each file to `POST /uploads` (raw body, up to 50 MB, no admin key).
   The format is detected from the contents, stricter than the admin upload: a 3MF must be a ZIP
   package with a 3D model part, a binary STL must be as long as its triangle count says, an ASCII
   STL must contain facets. A `.stl`/`.3mf` name that contradicts the contents is rejected; a
   missing extension is added. The response has a `fileId` and a secret `uploadKey`; only its
   SHA-256 hash is stored.
2. `POST /orders` with `{ source: "upload", customer, items: [{ fileId, uploadKey, quantity,
   profile, estimate?, parts: [{ key, name, filamentId, colorId }] }], customerNote? }` (1–10
   distinct files, 1–20 copies each, 1–16 distinct color parts per file) creates the order.
   `profile` is `{ printer, process, filament, support, scale }`: one printer, process and
   filament preset of the offered slicing profiles, supports on/off and the model's uniform scale
   (0.01–10). `estimate` is the browser's slicing of one copy, `{ printMinutes, filaments: [{ key,
   grams }] }` (keys are the color parts). The presets, filament and color of every part must be
   currently offered (otherwise 400 with per-file `details`; the storefront then reloads the
   options). The order stores the profile, a snapshot of the filament names, prices per kilogram,
   densities and colors, and each estimate with its copy price (`estimate.unitPrice`), so later
   changes don't alter them; `price.estimated` is set when every file has an estimate. Older
   storefronts may still send `nozzleId` and `layerHeightId` instead of a profile; they are
   checked as before. Each upload is claimed atomically for that order, so a file can't be
   attached twice or by someone who doesn't hold its key. Unknown, expired, mismatched or already
   used uploads return 409 with per-file `details`; the storefront then uploads the files again
   automatically.

Estimates use the shop's rates (`/settings/pricing`):

```text
copy price = round(print minutes / 60 × hourly rate) + Σ parts round(grams / 1000 × the part's filament price per kg)
estimate   = handling fee + Σ copy price × copies
```

`POST /uploads/estimate` with `{ items: [{ quantity, parts: [{ key, filamentId }], estimate: {
printMinutes, filaments: [{ key, grams }] } }] }` answers `{ items: [{ unitPrice }], handlingFee,
total, currency }`: the storefront shows only these prices, never the print time, weights or rates.

Customer files live in their own private store (`customerFiles`), never under the public
`/api/model-files/…`; they are downloaded only through `GET /orders/:id/files/:fileId`, with
`Content-Disposition: attachment` and `Cache-Control: private, no-store`. Deleting an order
deletes its files. Uploads never confirmed as part of an order (the customer left the summary
step, or confirming failed) are deleted after 24 hours: the server checks on start and then
hourly. An upload can be confirmed for 23 hours, so cleanup never deletes a file while an order
is claiming it. Back up this store together with the orders. The upload endpoint is public like
checkout; put a rate limit in front of the API (e.g. at the reverse proxy) if abuse is a concern.

### Orders of earlier versions

Earlier versions kept three kinds of orders — catalog orders, print requests (`custom_orders` /
`customOrders`) and project orders (`project_orders` / `projectOrders`) — each with its own
statuses, fields and endpoints. On start the server converts them all into orders (keeping ids,
numbers, customers, notes, files and dates) and drops the old tables or collections:

- statuses: `pending`, `submitted` and `new` become `received`; a print request's `approved`
  becomes `quoted`; the others keep their names;
- catalog orders: items become `catalog` models with their prices, `total` the fixed price;
- print requests: files become `upload` items with their estimates and reviews;
  `estimatedPrice`, `reviewedPrice` and `quotedPrice` become `price.estimated`, `reviewed` and
  `total`;
- project orders: items become `project` models, or — placed for a Print on Demand product — one
  `printOnDemand` item of `sets` sets. Their price review covered the whole order: it stays the
  price and becomes the measurements of the only item; orders of several models keep the price,
  and their models can be measured again one by one;
- log entries lose their order kind, and their statuses and email templates (`order.paid`,
  `customOrder.approved`) become the shared statuses; email templates are upgraded too (see
  *Log book and emails to customers*).

Storefronts of those versions keep working: `POST /custom-orders/files` and
`/custom-orders/estimate` (which also accepts `files` with `parts` estimates), `POST
/custom-orders`, `POST /project-orders` (with `notes`) and `POST /project-products/:id/orders`
place ordinary orders; the answers are the new documents plus the fields those storefronts read
(`files`, `estimatedPrice`, `quotedPrice`; `requiresQuote`, `review`). The admin endpoints of print
requests and project orders are gone: use `/orders`.

### Print options

`GET /print-settings` returns `{ profiles, nozzles, defaultNozzleId, layerHeights,
defaultLayerHeightId, filaments, updatedAt }`:

- `profiles`: `{ printers, processes, filaments }` — names of the bundled OrcaSlicer presets
  customers combine into their one slicing profile (each list non-empty, names unique, up to 30).
  Settings saved before slicing profiles get every bundled Snapmaker U1 preset on start.

- `nozzles` and `layerHeights` are no longer offered to customers (orders placed before
  slicing profiles keep their snapshots); they are still stored and validated:
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
0.4 mm nozzle (heights it can't print are dropped). Uploads ordered in that format keep their
snapshot; the admin shows them without print options or estimate.

Color parts are keyed as the frontends read the file: a 3MF color or material key (`filament:N`
for Bambu/Orca projects), or `model` for files without colors. The slicer's filament per
extruder goes to the `filament:N` parts; other multi-color models are split by each part's
surface-area share. Uploads ordered before slicing profiles are estimated in the admin as solid
volume × share × density ÷ 1000 × price per kilogram × the nozzle's and layer height's
multipliers. The shop sets the final price.

## Printers warehouse

The warehouse has two admin-only collections: **printer models** (`/api/printer-models`) and
the **printers** standing in the workshop (`/api/printers`). The print plate size, the number of
colors and the slicer profiles belong to the model; a printer only refers to its model by
`modelId`, so every change to a model shows on all its printers at once.

```json
{ "id": "…", "name": "Snapmaker U1", "manufacturer": "Snapmaker",
  "plate": { "widthMm": 270, "depthMm": 270, "heightMm": 270 }, "maxColors": 4,
  "profiles": { "fileId": "…", "fileName": "Snapmaker U1.orca_printer", "sizeBytes": 18231, "uploadedAt": "…",
                "entries": [{ "name": "printer/Snapmaker U1 (0.4 nozzle).json", "sizeBytes": 9210 }],
                "presets": { "machine": ["Snapmaker U1 (0.4 nozzle)"], "process": ["0.20 Standard @Snapmaker U1 (0.4 nozzle)"], "filament": [] } },
  "printers": [{ "id": "…", "name": "U1-01" }],
  "createdAt": "…", "updatedAt": "…" }
```

- **Models**: `name` (1–120 characters) is unique among the models ignoring case and surrounding
  whitespace (409 with a detail when taken); `manufacturer` (up to 80) is optional; `plate` is the
  build volume in millimeters (1–5000 per axis, rounded to 0.01 mm); `maxColors` (1–64) is how
  many filaments one job can use. Texts are trimmed; problems are reported all at once (400 with
  `details`). Responses list the model's `printers` (id and name, sorted by name). A model that
  printers still use can't be deleted (409 naming them). `GET /printer-models/templates` lists
  built-in known desktop FDM printers (name, manufacturer, plate size, colors) that the admin can
  start a new model from; they are not models of the warehouse until saved.
- **Printers**: `{ id, name, modelId, location, notes, createdAt, updatedAt }`. `name` (1–80) is
  unique among the printers ignoring case (409 when taken); `modelId` must be an existing model
  (400 otherwise); `location` (up to 200) describes where the printer stands; `notes` (up to
  2,000) is free text. Plate size, colors and profiles are refused in printer bodies. Responses
  add `model`: the model's current document (`null` if it is missing), and `queue` (see *Print
  queues*).
- **Profiles** (per model). `POST /printer-models/:id/profiles` stores the model's slicer profiles
  as one ZIP archive (raw body, `Content-Type: application/octet-stream`, up to 20 MB, the file
  name in `X-File-Name`), e.g. an OrcaSlicer printer export (`.orca_printer` files are ZIPs). The
  server checks that it is a readable ZIP with at least one file (400 otherwise), lists up to 200
  of its files and reads the JSON files for OrcaSlicer/Bambu Studio presets (`type` machine,
  process or filament with a `name`; up to 100 names per type). A new upload replaces the previous
  archive and deletes its file; `DELETE …/profiles` removes it. Archives live in the private
  `printerFiles` store and are downloaded only through the admin endpoint
  (`Cache-Control: private, no-store`). Deleting a model deletes its archive.
- **Upgrade**: printers saved by the first warehouse version carried their own model name, plate
  size, colors and profiles. On start the server gives each a model: the existing model with the
  same name (ignoring case) or a new one with the values of the most recently saved printer of
  that name. The model gets the profile archive of the most recently saved of those printers that
  had one (archives of other printers of that model stay stored but unused). Check the plate size
  and colors of upgraded models if their printers had differing values.

## Log book and emails to customers

Every order, whatever its source, has a **log book** (`log_entries` table in SQLite,
`logEntries` collection in MongoDB, keyed by the order id), newest first, holding:

- `status` entries: the status an order was placed with (`from: null`) and every change made
  by `PATCH` (changes to other fields are not logged);
- `emailSent` entries: every email the shop sent — automated (`template`: the status, e.g.
  `quoted`) or written by the admin (`template: null`) — with recipient, subject,
  text, `messageId` and `delivery`: `sent`, `outbox` (development) or `failed` with its error;
- `emailImported` entries: emails imported from .eml files (e.g. the customer's replies), parsed
  with mailparser: sender, recipients, subject, Date, Message-ID, the plain text (generated from
  the HTML part when there is none; any charset and transfer encoding, capped at 100,000
  characters) and attachment names and sizes. The original file is kept in the private
  `mailFiles` store for download. An email whose Message-ID is already in the log is refused
  (409); a sender other than the customer's address is accepted and flagged (`fromCustomer`).
  Files that aren't emails (no sender) are refused (400).

Deleting an order deletes its log book and imported files.

**Status emails.** `PATCH /orders/:id` accepts `notify: true` and an optional `note`: when the
status changes, the template for the new status is rendered and sent to the customer after
saving, and logged. Its required values are checked **before** anything is saved (400 with
details): e.g. a quote needs a price (which can be saved in the same request), and rejecting or
cancelling needs a `note` explaining why. A failed delivery never undoes the status change: it is
logged with its error. `POST …/email-preview` with `{ status, note?, price? }` renders the same
email for an unsaved form, with the template's `required` variables and the `missing` ones.
Messages are plain text (UTF-8); subjects are single lines, so no header can be injected.

**Templates.** One per status (11), the same for every source, editable with `PUT
/email-templates` and stored in the settings document `emailTemplates` (keyed by status); the
defaults are stored on start (in `APP_LANGUAGE`, English or Polish) and restored by `db:seed --
--reset`; templates for statuses added later are filled in from the defaults. Variables are
written `{{name}}`:

- `customerName`, `orderNumber`, `status` (localized), `orderDate`, `shopName`;
- `note`: the admin's message for that email (empty lines left by an empty note are removed);
- `price`: the order's price — fixed, or the quote (when sending a status change, the price being
  saved); while there is none the text says it will be quoted;
- `items`: one line per item — the product or Print on Demand product with copies and line price;
  an uploaded file with its filaments (and, for old orders, nozzle and layer height); a project
  model with its scale and filaments;
- `printStart`, `printDuration`, `printEnd`: while the order is in a print queue, when its print is
  expected to start (or started), how long it prints and when it should be printed (see *Print
  queues*); empty otherwise.

Required variables — which every saved template must contain and which must have a value when
sending: `orderNumber` everywhere; also `items` (received), `price` (quoted), `printStart` and
`printDuration` (queued) and `note` (rejected, cancelled). Unknown variables are refused. Stored
templates get the defaults of the `queued` and `done` statuses on start.

Templates stored by earlier versions (one set per order kind: `order.pending`,
`customOrder.approved`, …) are converted on start. Unedited ones get the new defaults. Edited ones
are kept for the matching status — received ← `order.pending`, quoted ← `customOrder.approved`,
rejected ← `customOrder.rejected`, paid/printing/shipped/delivered/cancelled ← the catalog
order's — with `total` and `quotedPrice` renamed to `price` and `files` to `items`, when they still
meet the rules above; otherwise, and for `accepted`, the default is used.

**Delivery** (`src/mail/mailer.ts`, nodemailer):

- `SMTP_HOST` set: SMTP with `SMTP_PORT` (587, or 465 with `SMTP_SECURE=true` for TLS from the
  start), optional `SMTP_USER`/`SMTP_PASSWORD` (STARTTLS is then required, credentials are
  never sent unencrypted), `MAIL_FROM` (required, e.g. `PrintForge <shop@example.com>`) and
  optional `MAIL_REPLY_TO`. Message-IDs use the MAIL_FROM domain.
- No SMTP in development: each email is written as an .eml file to `MAIL_OUTBOX_DIR`
  (`data/outbox`, git-ignored) and logged as `outbox`, so the whole flow works locally.
- No SMTP in production: sending is logged as `failed` ("not configured").

The server logs which mode it uses on start. Only the admin sends emails; placing an order
never emails the customer automatically (the `received` template can be sent from the admin), so
the public checkout can't be used to send mail.

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

`POST /api/orders` with `source: "project"` orders prints of such a project:

```json
{
  "source": "project",
  "customer": { "name": "…", "email": "…", "address": { "line1": "…", "city": "…", "postalCode": "…", "country": "…" } },
  "project": { "source": "printables", "id": "12345", "title": "…", "url": "https://www.printables.com/model/12345-…",
               "thumbnailUrl": null, "author": "…" },
  "items": [{ "file": { "id": "9", "name": "hook.stl" },
              "settings": { "quantity": 2, "scalePercent": 100,
                            "filaments": [{ "material": "PETG", "color": "black" }, { "material": "TPU", "color": "red" }] } }],
  "sameSettingsForAll": false,
  "customerNote": "No supports, please."
}
```

Each item is one model with its own print settings: quantity (1–20), scale (10–500 %) and
1–8 filaments (material `any|PLA|PETG|ABS|ASA|TPU|resin` plus a free-text color), several for
multi-color or multi-material prints. `file: null` orders the whole project and must be the
only item (for sites that list no files); a file may appear once. With
`sameSettingsForAll: true` every item must carry identical settings. The project URL must be
HTTPS on the source's own domain. The server fetches the project again (normally from the
cache) and stores the verified project and file details; if the site cannot be reached, the
customer's copy is stored and `project.verified` is false so the admin checks the link before
quoting. Each item becomes a `project` model (`file`, `scalePercent`, `filaments`) with its
quantity; the order stores the project with `verified` and `sameSettingsForAll`. Project orders
get `PJ-…` numbers and need a quote: the shop measures the models (see *Orders*) and sets the
price. Project orders saved by the first version (one `preferences` object for a list of `files`)
are upgraded on startup into one item per file sharing those settings.

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
orders keep the handling fee in `price.handlingFee`, apart from their items; checkout always uses
current rates. Orders placed before the handling fee existed have `price.handlingFee: 0`.
There is no database migration or reseeding. Legacy base-price fields remain stored for
compatibility, but cannot override current catalog pricing.

### Product scaling

`scaling: { enabled, minScale, maxScale }` sets which sizes customers may order, as uniform scale
factors of the original size (1 = 100%):

- `enabled: false` — sold at the original size only; any size sent at checkout is replaced by
  the original one.
- `enabled: true` — every size from `minScale` (≤ 1) to `maxScale` (≥ 1) within the printer's
  limits (each side 5–270 mm); validation rejects ranges outside those limits. Checkout rejects
  sizes outside the range: "Choose a size from 60% to 140% of the original."
- omitted (products saved before the setting) — scalable within the printer's limits, as before.

The scale of an order is the geometric mean of its axis scales (sizes are proportional), to 0.1%.

### Sliced print variants

A catalog product with a model file can be priced from **slicing results** instead of the
volume estimate. The admin editor slices each included plate (or the whole model of a file
without plates) with a matrix of OrcaSlicer presets in the browser; the product stores them in
`slicing`:

```jsonc
"slicing": [{
  "plateId": 1,                       // null: the whole model of a file without plates
  "matrix": { "printers": [...], "processes": [...], "filaments": [...] },
  "support": false,                   // one setting for every variant of the plate
  "overrides": { "sparse_infill_density": "20%" },   // Orca options for every variant
  "variants": [{
    "id": "n4-l20", "label": "Fine: 0.20 mm layers, 0.4 mm nozzle",
    "presets": { "printer": "...", "process": "...", "filament": "..." },
    "nozzleMm": 0.4, "layerHeightMm": 0.2, "material": "PLA",
    "measurements": { "printMinutes": 198, "filaments": [{ "material": "PLA", "grams": 123.1 }] },
    "sliced": { "printMinutes": 198, "filaments": [...], "slicedAt": "..." },  // the slicer's own result
    "scaled": [                       // the same plate sliced at the ends of the scale range
      { "scale": 0.6, "measurements": { "printMinutes": 70.2, "filaments": [...] }, "sliced": {...} },
      { "scale": 1.4, "measurements": { "printMinutes": 408.6, "filaments": [...] }, "sliced": {...} }
    ],
    "enabled": true                   // offered to customers
  }],
  "defaultVariantId": "n4-l20"
}]
```

`measurements` (original size) and `scaled[].measurements` are what price the variant (the admin
may adjust the sliced values; `sliced` keeps the slicer's result for reference). Each point is
priced with the same rates as orders that need a quote, without the handling fee; prices at other sizes
are interpolated between the two nearest points along the power law through them (exact when
the price grows with a power of the scale, e.g. area or volume):

```text
point price   = round(print minutes / 60 × hourly rate) + Σ round(grams / 1000 × material price per kg)
price at s    = pₐ × (s / a)^k  with  k = ln(p_b / pₐ) / ln(b / a)   (a ≤ s ≤ b: neighbouring points)
print price   = Σ round(chosen variants' prices at s)
```

Scalable products need every offered variant of an included plate sliced at `minScale` and
`maxScale` ("not sliced at 50%: slice the variants again after changing the scaling"); fixed-size
products need only the original size. A variant with only the original size (older data) scales
with the volume (k = 3).

Variant pricing applies only when **every** included plate offers at least one enabled variant;
otherwise the product keeps the volume estimate (validation rejects partial setups: "offer at
least one print variant on every included plate, or none"). Other rules: plates must exist in
the model file, at most 60 variants per plate, unique ids, non-empty names, positive nozzle,
layer height, time (≤ 30 days) and grams, and the default must be an offered variant.

Customers choose a variant per plate in `customization.plates[id].variantId` (products without
plates: `customization.variantId`); missing or withdrawn choices fall back to the default. The
server reprices orders from current measurements and rates, and every ordered plate's
`appearance.printVariant` (or the item's `printVariant`) snapshots the label, nozzle, layer
height and material plus the presets, supports and options the shop prints it with.

Public product responses contain only the offered variants of included plates (`id`, `label`,
`nozzleMm`, `layerHeightMm`, `material`), never the presets, matrix or measurements, and
`catalogPricing.variantPrices` — the original-size price of each offered variant keyed
`"<plateId|model>:<variantId>"` — plus `catalogPricing.variantScalePrices` with the prices at
the other sliced scales (`[{ scale, price }]`), so the storefront interpolates exactly like the
server. The hourly rate and filament prices are sent to admins only.

### Pricing project orders

Every project price is calculated from **measurements** — print time and grams of filament per
material (`PLA|PETG|ABS|ASA|TPU|resin`) — with the shop-wide **rates**:

    price = handling fee + print time (h) × printer hourly rate + Σ grams / 1000 × price per kg

with every part rounded to cents (rows of one material are added up). The rates are edited in one
place (`PUT /api/settings/pricing`: `{ hourlyRate, handlingFee, filamentPricePerKg: { PLA, PETG,
ABS, ASA, TPU, resin } }`, amounts in USD, ≥ 0); until the admin saves them, `GET` answers defaults
with `updatedAt: null`.

**Print on Demand products** (formerly "ready-to-print") store only the measurements of one set
(`measurements`), never a price: every response calculates it with the current rates, so a rate
change reprices every product at once. Admins receive `measurements` and the calculated `pricing`
breakdown and can change the measurements (`PATCH /api/project-products/:id` with
`{ measurements }`); customers receive only `price: { total, handlingFee, setPrice, currency }`.
A product is created from a project order whose models are all measured (`POST
/api/project-products` with `{ orderId, title, description, published }`; 400 otherwise), taking
its project, models and settings; one set's measurements are every item's measurements × its
copies, added up per material.

**Sliced Print on Demand products** get the catalog's slicing and scaling: the admin uploads the
shop's print file (`mesh`: STL, or a 3MF whose included plates hold the project's models) with its
size (`model`), slices print variants per plate (`slicing`, as for catalog products, including the
other scales) and sets `scaling`; `PATCH` validates them like catalog products (a file is needed
for variants and scaling; without `scaling` the set is printed at its original size). When every
included plate offers a variant:

- one set's measurements are the chosen variants' print time and grams per material, each
  interpolated between the sliced scales at the chosen scale (the power law through the two
  nearest scales), priced together with the rates above — `price` and admin `pricing` use the
  default variants at the original size;
- customers receive `printOptions: { plates: [{ plateId, name, defaultVariantId, variants: [{ id,
  label, nozzleMm, layerHeightMm, material }] }], scale: { min, max }, size }`, never the presets,
  measurements or file;
- `POST /api/project-products/:id/quote` with `{ sets, print?: { scale, variants: { <plateId|model>:
  variantId } } }` answers `{ sets, setPrice, handlingFee, total, currency, print, variantPrices }`
  (`variantPrices`: one set's price of every variant of every plate at that scale). Withdrawn
  variants fall back to the defaults; a scale outside the range is a 400 ("Choose a size from 50%
  to 120% of the original.").
- Orders take the same `print` choice: priced at once (the variants decide the materials — only
  colors are the customer's), the item's `model.print` keeps the scale and every plate's variant
  with its presets, supports and options, and each model's `scalePercent` is multiplied by the
  scale.

**Orders** store their price when they are placed (see *Orders*), so rate changes never touch it:

- `POST /api/orders` with `{ source: "printOnDemand", customer, productId, sets (1–20),
  customerNote?, items?, print? }` orders `sets` copies of a published product: one
  `printOnDemand` item with `quantity: sets`. `items` lists the customer's filaments for every
  model in the product's order (`[{ fileId, filaments: [{ material, color }] }]`, same models and
  number of filaments; omitted: as offered). **Colors** are free and keep the price: the order is
  priced at once from one set's measurements with the current rates (`price.mode: "fixed"`, the
  item's `unitPrice` is the set price, `total = handlingFee + sets × setPrice`) and the price is
  final — `PATCH` with another price answers 409. **Another material** makes it an order that needs
  a quote: `price.mode: "quote"`, no price yet, `model.materialsChanged: true`.
- Orders for projects found by search always need a quote. The admin measures each model with
  `PUT /api/orders/:id/items/:index/review` and `{ printMinutes, filaments: [{ key: <material>,
  grams }] }` using the current rates, and sets the price; measuring again updates the reviewed
  price, not the quote.

Data from earlier versions is upgraded on startup: products' stored price snapshots become their
measurements, and project orders become orders (see *Orders of earlier versions*). SQLite keeps
products and settings in `project_products` and `settings`; MongoDB in `projectProducts` and
`settings`.

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
