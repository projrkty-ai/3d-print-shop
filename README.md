# PrintForge: independent applications and slicer estimator

| Application | Directory | Development URL |
|---|---|---|
| Backend API (SQLite locally, MongoDB in production) | [backend](backend/) | http://localhost:3001/api |
| Customer storefront | [frontend-client](frontend-client/) | http://localhost:5173 |
| Administration | [frontend-admin](frontend-admin/) | http://localhost:5174 |
| Print time / filament estimator (CLI, Node API, browser engine) | [slicer](slicer/) | Admin tab *Slicer test* |

Each directory is a standalone project with its own package manifest, lockfile,
dependencies, environment configuration, source code and tests. There is no root npm
project, workspace, shared package, symlink, cross-application import or shared build.
An application directory can be copied to a separate repository and installed on its own.
The applications communicate only over HTTP; the two frontends never import backend
source or each other's code. Similar types, validation and 3D helpers are independent
copies and must be maintained separately when changing the HTTP contract.

## Start locally

Requires Node 22.13+ and npm. No database server is needed: in development the backend
stores everything, including uploads, in the SQLite file `backend/data/printforge.sqlite`
(Node's built-in SQLite), seeded with the demo catalog on first start.

Start all three applications with one command from the repository root:

```bash
node scripts/start-local.mjs
```

It runs `npm ci` in applications without `node_modules` (`--install` reinstalls all),
creates missing `.env` files from `.env.example` with a random backend `ADMIN_TOKEN`,
checks ports 3001/5173/5174, starts the API, waits until it answers, then starts both
frontends. Output is labelled `[api]`, `[shop]` and `[admin]`; the summary shows the URLs
and the admin key. Ctrl+C stops everything, and if one application exits the others stop
too. The script only runs each application's own `npm run dev`; it is not a root npm
project and adds no dependencies. On Windows, the application processes run separately
from the launcher's console so Ctrl+C can stop their complete process trees. If shutdown
fails, the launcher reports the affected process rather than silently ignoring it.
Run `node --test scripts/start-local.test.mjs` to check launcher shutdown with isolated
fixture applications. Delete `backend/data/` to start again with a fresh
catalog. Without SMTP settings, emails the admin sends to customers are saved as .eml files in
`backend/data/outbox/` (see the backend README to configure real delivery).

To run the applications separately instead, use one terminal per application:

```bash
cd backend
npm ci
cp .env.example .env
# Replace ADMIN_TOKEN in .env with a unique secret.
npm run dev
```

```bash
cd frontend-client
npm ci
cp .env.example .env
npm run dev
```

```bash
cd frontend-admin
npm ci
cp .env.example .env
npm run dev
```

The admin root redirects to `/admin`; sign in there using the backend's `ADMIN_TOKEN`.
The customer application has no administration routes, admin token handling or product
mutation endpoints. Unpublished product previews live inside the admin application.
Existing MongoDB data, customer cart and per-product browser drafts keep their previous
formats. To retain browser drafts, continue hosting the shop at its existing origin.
To keep developing against MongoDB, set `DATABASE=mongodb` in `backend/.env` and run
`docker compose up -d` in `backend/`; the Compose project name retains the original
development MongoDB volume. Local MongoDB data is not copied into SQLite.

## Build and test independently

Inside **each** application directory:

```bash
npm test
npm run build
```

The backend build type-checks its standalone TypeScript server; production starts with
`npm start`. Each frontend build creates its own `dist/`; `npm run preview` serves a
local preview (customer port 4173, admin port 4174).

## Deploy separately

- Deploy the backend as a Node application with MongoDB (`npm start` uses MongoDB unless
  `DATABASE=sqlite` is set); it serves `/api` and its own demo assets under `/models`,
  never an HTML frontend.
- Build each frontend with `VITE_API_URL=https://api.example.com/api` and host its
  `dist/` independently, rewriting non-file routes to that frontend's `index.html`.
- Set the backend's `CORS_ORIGINS` to the exact storefront and admin origins, separated
  by commas, without paths or trailing slashes.
- Set admin `VITE_STOREFRONT_URL` to the customer application's URL.
- Uploaded `/api/model-files/...` and bundled `/models/...` URLs resolve against the API
  origin. Existing database URLs do not need rewriting.
- Alternatively, keep `VITE_API_URL=/api` and configure each web host to proxy `/api`
  and `/models` to the backend. Development and preview servers already do this using
  their own `API_PROXY_TARGET`.
- Never put `ADMIN_TOKEN` in any `VITE_*` variable: frontend environment values are public.
- The storefront's model search (Thingiverse, Printables, MakerWorld) runs through the backend;
  set `THINGIVERSE_TOKEN` there to include Thingiverse. See `backend/README.md`.

Feature and API details are documented separately in each application's README.

The storefront supports catalog customization, printing customers' own STL/3MF files,
external model search and Print on Demand projects. All of these are **one kind of order**: the
same statuses (received → quoted → accepted → paid → in queue → printing → done → shipped →
delivered, or rejected / cancelled), price rules (fixed when ordering, or quoted by the shop), per-item measurements,
processing, log book, status emails and admin pages (**Orders**); only the source of the models
differs, and with it how the admin slices them. Administration also has print options, email
templates, Print on Demand products and pricing, and keeps a printers warehouse: printer models
(print plate size, color count and an uploaded slicer profile archive, shared by all printers of
the model) and the workshop's printers with their unique names, model and standing place. Orders
"in queue" wait in a printer's queue, which the admin works through (printing, done, removed); the
customer's email states when printing should start and end, with a 1 h break between prints.
The backend upgrades databases of earlier versions without reseeding existing data, converting
their separate print requests and project orders into orders. Back up the SQLite file with the
server stopped before deploying: schema 6 (one `orders` table for every order) cannot be opened by
older backend versions.

## Print time and filament estimate

[`slicer/`](slicer/) slices 3MF/STL models with the OrcaSlicer profiles in [`profiles/`](profiles/) and
reports print time and filament usage, including multi-colour painted models, copies and supports.
It is calibrated and verified against 33 OrcaSlicer 2.3 results (`slicer/references/`):

```bash
cd slicer && npm ci
node slice.mjs ../profiles/SliceTest.3mf --process "0.20 Standard @Snapmaker U1 (0.4 nozzle)" --support
```

The administration app has a **Slicer test** tab that runs the same engine in the browser (vendored
copies in `frontend-admin/src/slicer/engine` and `frontend-client/src/slicer/engine`, refreshed
with `npm run sync-frontend` in `slicer/`).
The product editor uses it too: each product plate can be sliced with a matrix of printers ×
processes × filaments into **print variants** whose (editable) print time and filament price the
product; customers choose a variant per plate. Products can be scalable within an admin-set range
(the **Scaling** card); variants are then also sliced at the smallest and largest scale (the
engine's `scale` option / `--scale`) and prices in between are interpolated (see the
administration and backend READMEs). **Print on Demand** products (formerly "Ready to print") get
the same slicing, scaling and pricing from a print file the admin uploads. In **Print your model**
the customer chooses one slicing profile and a scale; their browser slices each model to show an
estimated price only. On every order the admin can slice the items in the browser, adapted to the
source — an uploaded model with exactly the customer's profile, a catalog or Print on Demand item
with the ordered print variants at the ordered size, an external project's files with presets the
admin chooses — edit the result and quote the final price from it. For external project and Print
on Demand orders the project's model files are downloaded from Thingiverse, Printables or
MakerWorld through the backend (which keeps no copies) whenever the admin slices them or saves them
for printing (one by one or as a ZIP), without handling files by hand.
