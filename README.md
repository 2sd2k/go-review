# Go Game Assistant

A post-game Go review application inspired by Chess.com's move review. It reads
SGF games, analyzes every position with KataGo, visualizes win rate, score,
ownership, and candidate moves, and is intended to grow into an interactive Go
coach.

## Current architecture

- `frontend/`: React 19, TypeScript, Vite, Zustand, Recharts, and a canvas goban
- `backend/`: FastAPI WebSocket API, a SQLite job queue, and a separate
  long-lived KataGo worker process
- KataGo's JSON analysis engine is the source of win rate, score lead,
  ownership, and principal variations

## Run locally

Set `KATAGO_BINARY`, `KATAGO_MODEL`, and `KATAGO_CONFIG` if KataGo is not
installed in the Homebrew locations currently used as defaults. Use Python
3.13 for the backend (see `backend/.python-version`). The commands below use
[`uv`](https://docs.astral.sh/uv/) and a separate `.venv313`, so an existing
Python 3.9 `.venv` stays untouched.

```sh
cd backend
uv venv --python 3.13 .venv313
source .venv313/bin/activate
uv pip sync requirements.txt --require-hashes --python .venv313/bin/python
uvicorn app.main:app --reload
```

In a second terminal, from `backend/` with the same virtual environment and
KataGo settings, start the analysis worker:

```sh
python -m app.worker
```

In a third terminal:

```sh
cd frontend
npm install
npm run dev
```

For a deployed frontend, set `VITE_API_URL` to the public HTTP(S) base URL of
the backend. Use HTTPS in production so auth tokens travel over HTTPS/WSS.
Set `VITE_KATAGO_MODEL_VERSION` to the deployed KataGo network
identifier so cached reviews are invalidated when the model changes. Set
backend `CORS_ORIGINS` to a comma-separated list of allowed frontend origins.
Local development defaults allow `localhost` and `127.0.0.1` on ports
5173–5179 and 3000, so Vite can fall back to the next free port. If the
WebSocket still returns 403, check the rejected `Origin` in the backend log
and add that exact origin to `CORS_ORIGINS` before restarting Uvicorn.
The API and worker must share `ANALYSIS_JOB_DB` (defaults to
`backend/analysis_jobs.sqlite3`). This SQLite queue supports separate processes
on one host; it is not a multi-host job broker. The API reports worker
availability at `/api/health` and refuses new analyses while no worker is
online. Analysis progress and results are persisted as events. If the
WebSocket drops, the browser reconnects and replays saved results rather than
starting another review. If it cannot reconnect automatically, click
**Analyze Game** again; reopening the same game in the same browser tab can
also rejoin its session-stored job. The **Stop Analysis** button explicitly
cancels queued or in-flight work and asks KataGo to terminate unfinished
queries without restarting the engine. Game jobs are capped at 1,000 visits
per position, 500,000 total visits, and 20 minutes; focused coach searches
are capped at 200 visits and 45 seconds. Queued game records and engine
results are stored in this local database. Finished jobs are removed after
one day when a new job is submitted; the database is not encrypted or
suitable for shared hosting without additional controls. Restart both the
API and worker after changing backend code if they are not running with reload.

See [ROADMAP.md](./ROADMAP.md) for the recommended build sequence.

Backend direct dependencies are declared in `backend/requirements.in`; the
universal, hash-locked `backend/requirements.txt` is generated with
`uv pip compile requirements.in --python-version 3.13 --universal --generate-hashes --output-file requirements.txt`
from `backend/` (add `--upgrade` when updating the entire lock). Recompile
deliberately when upgrading packages, then rerun the backend tests under
Python 3.13.

## Managed sign-in and operations

Local development still works without an auth project. For managed sign-in,
create a Supabase project, enable email Magic Links, and allow your frontend
origin in Supabase's Auth URL configuration (for example,
`http://localhost:5173` or the actual Vite port). Set these environment
variables before starting each process:

| Frontend | Backend | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `SUPABASE_URL` | Your project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` | Its publishable key |

Set `AUTH_REQUIRED=1` on the backend for any public deployment. The frontend
publishable key is safe to expose; **never** put a Supabase secret or service-role
key in a `VITE_` variable. The backend verifies each bearer token with your
Supabase Auth service and associates game-analysis jobs with the verified user.
Existing anonymous jobs cannot be resumed after auth is enabled. Authenticated
users currently get at most two active game reviews and ten new reviews per
hour; the coach uses SQLite-backed per-user and global quotas shared by API
processes on the same host. This does not add cloud review storage or sync.

`/api/health/live` reports API liveness; `/api/health/ready` returns 503 unless
the SQLite database, KataGo worker, and auth configuration are ready.
`/api/metrics` is disabled unless `METRICS_TOKEN` is set on the backend; then
send that token in `X-Metrics-Token` to read route-level request counts and
total durations. Responses carry `X-Request-ID`, and server logs record route
templates, status, latency, and errors without question text, tokens, or SGF
content. Metrics are per API process; use a central collector for multi-host
deployments. A hosted error-reporting sink and live Supabase sign-in test are
still pending.

## Import and saved reviews

Paste a public OGS game URL or ID into **Import OGS** with the backend running,
or upload an SGF file (up to 5 MB). Private games require a manual SGF upload.
The backend only fetches OGS game records; it does not forward account credentials.

Use **Save current review** once to keep the game, variations, settings, and
current analysis in this browser. Later changes save automatically. Search,
rename, or delete saved reviews, and reopen one at the last viewed move after
a refresh. Saving the same imported game updates that entry. The original SGF is retained
separately from edits. Browser storage is device-specific and may be cleared by
the browser; download SGF for a portable copy of the game and variations.
Accounts and cloud sync are not implemented yet.

## Position coach

The chat panel is always visible in the right sidebar. Play or upload a game,
run analysis, then select an analyzed main-line move to ask a question. Chat
history is kept per move while the game remains open; loading another game
starts fresh. Questions about variations are not supported yet. Set
`OPENAI_API_KEY` on the backend to receive answers. Without it, the panel
remains visible but the backend reports that the key is needed when you ask.
`OPENAI_COACH_MODEL` defaults to `gpt-5-mini` and can be changed.
The coach sends only the selected position, a short move history, and bounded
KataGo candidate data to the model. It shows the underlying engine evidence
separately from the model's explanation. For an unevaluated candidate, it can
request one focused KataGo search (up to 200 visits) before answering. Exploratory
continuations are capped at four moves. Focused searches use the same running
KataGo worker as game reviews, with higher query priority.
The response separates KataGo facts, the coach's teaching interpretation, and
what remains uncertain; interpretations are not engine conclusions.
Choose concise or technical answers and an auto-detected or manually selected
teaching level. Auto uses the reviewed player's SGF rank when available.
The API key stays on the backend. Requests set `store: false` on the model API.
The coach accepts at most 32 KiB of request context and caps each
model call at 450 output tokens, with at most two calls and one focused KataGo
search per question. With Supabase configured, shared SQLite limits default to
20 questions/hour per authenticated user, 100/hour globally, and two
simultaneous questions. Set `COACH_REQUESTS_PER_USER_HOUR`,
`COACH_REQUESTS_GLOBAL_HOUR`, or `COACH_MAX_IN_FLIGHT` to adjust them. Without
Supabase, the original process-local address-based limits remain for local
development (`COACH_REQUESTS_PER_CLIENT_HOUR`). HTTP 429 responses include `Retry-After`.
Coach usage records include model token counts, latency, and whether an exact
request repeated; they do not include questions or game positions. Uvicorn's
default access log may still record connection addresses. There is no
answer cache yet. Configure an OpenAI project hard spend limit separately
before exposing the coach publicly.

## Test

```sh
cd frontend
npm test
npm run lint
npm run build

cd ../backend
source .venv313/bin/activate
python -m unittest discover -s tests -v
```

The backend suite includes a fake KataGo subprocess, so these protocol tests
do not need a GPU or downloaded model. A real KataGo smoke test is still
optional and hardware-specific.
