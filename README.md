# PrintForge: three independent applications

| Application | Directory | Development URL |
|---|---|---|
| Backend API and MongoDB | [backend](backend/) | http://localhost:3001/api |
| Customer storefront | [frontend-client](frontend-client/) | http://localhost:5173 |
| Administration | [frontend-admin](frontend-admin/) | http://localhost:5174 |

Each directory is a standalone project with its own package manifest, lockfile,
dependencies, environment configuration, source code and tests. There is no root npm
project, workspace, shared package, symlink, cross-application import or shared build.
An application directory can be copied to a separate repository and installed on its own.
The applications communicate only over HTTP; the two frontends never import backend
source or each other's code. Similar types, validation and 3D helpers are independent
copies and must be maintained separately when changing the HTTP contract.

## Start locally

Requires Node 22+, npm and MongoDB. Run each application in a separate terminal.

```bash
cd backend
npm ci
cp .env.example .env
# Replace ADMIN_TOKEN in .env with a unique secret.
docker compose up -d
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
The backend's Compose project name retains the original development MongoDB volume.

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

- Deploy the backend as a Node application with MongoDB; it serves `/api` and its own
  demo assets under `/models`, never an HTML frontend.
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

Feature and API details are documented separately in each application's README.
