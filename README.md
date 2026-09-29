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
installed in the Homebrew locations currently used as defaults.

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
the backend. Set `VITE_KATAGO_MODEL_VERSION` to the deployed KataGo network
identifier so cached reviews are invalidated when the model changes. Set
backend `CORS_ORIGINS` to a comma-separated list of allowed frontend origins.
The API and worker must share `ANALYSIS_JOB_DB` (defaults to
`backend/analysis_jobs.sqlite3`). This SQLite queue supports separate processes
on one host; it is not a multi-host job broker. The API reports worker
availability at `/api/health` and refuses new analyses while no worker is
online. Closing the analysis connection cancels its queued job. A worker
checks cancellation between results and restarts KataGo to discard that game's
pending queries; immediate interruption of an in-flight search is Phase 5.2.
Queued game records and engine results are stored in this local database. Finished
jobs are removed after one day when a new job is submitted; the database is
not encrypted or suitable for shared hosting without additional controls.

See [ROADMAP.md](./ROADMAP.md) for the recommended build sequence.

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
continuations are capped at four moves. This requires the local KataGo engine.
The response separates KataGo facts, the coach's teaching interpretation, and
what remains uncertain; interpretations are not engine conclusions.
Choose concise or technical answers and an auto-detected or manually selected
teaching level. Auto uses the reviewed player's SGF rank when available.
The API key stays on the backend. Requests set `store: false` on the model API.
The prototype coach accepts at most 32 KiB of request context and caps each
model call at 450 output tokens, with at most two calls and one focused KataGo
search per question. Its process-local limits default to 20 questions/hour per
connection address, 100/hour globally, and two simultaneous questions. Set
`COACH_REQUESTS_PER_CLIENT_HOUR`, `COACH_REQUESTS_GLOBAL_HOUR`, or
`COACH_MAX_IN_FLIGHT` to adjust them. HTTP 429 responses include `Retry-After`.
Logs record model token counts, latency, and whether an exact request repeated;
they do not record questions, game positions, or client addresses. There is no
answer cache yet. These address-based limits are not authenticated per-user
quotas and do not coordinate across multiple backend workers. Configure an
OpenAI project hard spend limit separately before exposing the coach publicly.

## Test

```sh
cd frontend
npm test
npm run lint
npm run build

cd ../backend
python3 -m unittest discover -s tests -v
```
