# GoComet British Auction RFQ

This application lets buyers create freight RFQs and suppliers submit competing
quotes in a British auction. It ranks quotes and extends the closing time when
a bid meets the configured trigger, up to a fixed deadline.

[HLD and schema](docs/HLD.md)

## Local setup

Prerequisites: Python 3.12, native PostgreSQL 17, Node.js 24 and npm 12.
Start PostgreSQL first. Run commands from the extracted repository root unless
a command changes directory.

### 1. Create databases

In psql or pgAdmin, connect as a local PostgreSQL administrator and run this
once for a new role/databases, replacing the password placeholder:

~~~sql
CREATE USER gocomet WITH PASSWORD 'YOUR_LOCAL_PASSWORD';
CREATE DATABASE gocomet_rfq OWNER gocomet;
CREATE DATABASE gocomet_rfq_test OWNER gocomet;
~~~

`gocomet_rfq` holds application data. `gocomet_rfq_test` is disposable test data:
tests delete rows and exercise migration downgrade/upgrade there. Never use it
for application data. The role owns both databases for migrations. Before any
test cleanup, the guard checks the configured and connected database name,
loopback host/server address and port.

### 2. Install and configure

Windows CMD:

~~~bat
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -r backend\requirements.txt
if not exist .env copy .env.example .env
if not exist frontend\.env copy frontend\.env.example frontend\.env
npm.cmd --prefix frontend ci
~~~

macOS/Linux (bash or zsh; `python3` must be Python 3.12):

~~~sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
test -f .env || cp .env.example .env
test -f frontend/.env || cp frontend/.env.example frontend/.env
npm --prefix frontend ci
~~~

Edit the root `.env`: set `DB_PASSWORD` to the chosen local password; confirm
`DB_HOST=localhost`, `DB_PORT=5432`, `DB_USER=gocomet`,
`DB_NAME=gocomet_rfq` and `TEST_DB_NAME=gocomet_rfq_test`. Environment variables
override the file. `CORS_ORIGINS` is a JSON array; its defaults allow
`http://localhost:5173` and `http://127.0.0.1:5173`.

The frontend example sets only `VITE_API_BASE_URL=http://127.0.0.1:8000`.
All `VITE_*` values are public; keep credentials in backend configuration.
Restart Vite if the API URL changes.

### 3. Start the application

Terminal 1, with the virtual environment activated above (both platforms):

~~~sh
python -m alembic upgrade head
python -m backend.app.demo
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
~~~

For later runs, activate first with `call .venv\Scripts\activate.bat` in
Windows CMD or `. .venv/bin/activate` in macOS/Linux.

Terminal 2, Windows CMD:

~~~bat
npm.cmd --prefix frontend run dev
~~~

Terminal 2, macOS/Linux:

~~~sh
npm --prefix frontend run dev
~~~

Open **http://127.0.0.1:5173**. API/OpenAPI docs: **http://127.0.0.1:8000/docs**;
health: **http://127.0.0.1:8000/health**. Stop servers with Ctrl+C.
For a built preview, stop Vite dev, build with the command below, then use
`npm.cmd --prefix frontend run preview` (Windows) or
`npm --prefix frontend run preview` (macOS/Linux); preview also uses port 5173.

Demo setup seeds Atlas Logistics, Beacon Freight and Cedar Transport (IDs 1–3),
preserves existing records and reuses an active demo; otherwise it creates a
fresh auction. `python -m backend.app.demo --new-auction` adds another explicitly.
Suppliers are preconfigured for this demonstration; there is no authentication.

## Demo flow

1. Create an RFQ with a unique reference, start one minute ago, initial close
   five minutes ahead, forced close two hours ahead, X=120, Y=3 and Any new bid.
   Set a service UTC date tomorrow or later.
2. Select Atlas; enter a carrier, freight 100.00, origin 20.00, destination 10.00,
   transit 24 hours and validity through service. Submit: total INR 130.00 is L1
   and close advances three minutes. With Beacon, change freight to 90.00:
   total 120.00 becomes L1 and close advances again.
3. Select Atlas and try its previous 130.00 total: the form rejects the rebid.
   Lower freight to 80.00 (total 110.00). Inspect supplier rankings, full bid
   history and the activity log's extension reasons and old/new close times.

X=120 keeps this short demo inside the closing window after repeated extensions;
forced close still caps each advance. Other trigger semantics are in
[auction rules](docs/HLD.md#auction-rules).

## Render deployment

[`render.yaml`](render.yaml) defines a free Python API and static site using a
separately provisioned PostgreSQL database.

1. Use a free Render PostgreSQL database and set the API's `region` to match it.
   Connect the repository's `main` branch in Render and apply the Blueprint with
   the free API plan.
2. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` in the API's
   environment settings from the database connection details. Use its internal
   hostname and keep credentials in backend settings. Never run tests against
   this application database.
3. Set the static site's `VITE_API_BASE_URL` to the API's HTTPS URL before building.
   Set the API's `CORS_ORIGINS` to a JSON array containing the static site's HTTPS
   origin, `http://localhost:5173` and `http://127.0.0.1:5173`. Redeploy after changing
   these settings; frontend environment changes require a fresh build.

The API runs from the repository root, applies Alembic migrations, seeds the
non-destructive demonstration and starts one Uvicorn worker. The static site
builds from `frontend/` and rewrites direct routes to `index.html`.

Free APIs sleep after 15 idle minutes and can take about a minute to wake. If the
UI reports a connection error, wait and use **Refresh saved data**. After an
uncertain submission, inspect saved history before submitting again; POSTs are
never automatically retried. Free databases expire 30 days after creation.
See [Render's free limits](https://render.com/docs/free).

## Assumptions and recovery

- Currency is INR; transit time is integer hours. X/Y, transit and supplier IDs
  are positive signed 32-bit integers. References are unique and case-sensitive;
  British Auction is enabled and configuration is fixed after creation.
- **Implementation assumption:** pickup/service date must be on or after the
  forced-close UTC calendar date. Quote validity is inclusive and must cover
  both service and acceptance dates.
- Timestamp inputs include a timezone; the UI converts local times to UTC and
  identifies the display timezone. Service/validity remain UTC calendar dates.
  [HLD](docs/HLD.md) describes exact price, tie, timing, trigger and status rules.

POSTs never automatically retry or queue offline. After a lost response, refresh
saved history/rankings and check for the bid before retrying; uncertain creation
can reconcile by unique reference. Inputs survive errors and background refresh.
There are no backend idempotency keys. Active auctions poll every five seconds;
reads return the full bounded dataset without pagination.

## Checks

Use an activated virtual environment at the repository root, with PostgreSQL
configured. These backend commands work on both platforms:

~~~sh
python -m pytest -q
python -m ruff check backend
python -m ruff format --check backend
python -m mypy backend
python -m pip check
python -m alembic check
~~~

Frontend, Windows CMD:

~~~bat
cd frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
cd ..
~~~

Frontend, macOS/Linux:

~~~sh
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
cd ..
~~~

Browser checks require the local API and Vite dev/preview running. From
`frontend/`, install Chromium once and run:

| Platform | Install | Run |
| --- | --- | --- |
| Windows CMD | `npx.cmd playwright install chromium` | `npm.cmd run test:browser` |
| macOS/Linux | `npx playwright install chromium` | `npm run test:browser` |

Backend integration/concurrency checks use PostgreSQL and the guarded test
database. Browser tests add uniquely named data without cleanup; their scope is
Chromium with mobile viewport emulation. Output goes to ignored
`frontend/test-results/` and `frontend/playwright-report/`.
If changing the API address, set `E2E_API_BASE_URL` to match `VITE_API_BASE_URL`.
The pinned Starlette TestClient emits a known HTTPX deprecation warning.

[HLD and schema](docs/HLD.md) ·
[Migration](backend/migrations/versions/52b4f1033008_initial_auction_schema.py) ·
[Backend](backend/app) · [Frontend](frontend/src)
