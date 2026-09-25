# Go Game Assistant

A post-game Go review application inspired by Chess.com's move review. It reads
SGF games, analyzes every position with KataGo, visualizes win rate, score,
ownership, and candidate moves, and is intended to grow into an interactive Go
coach.

## Current architecture

- `frontend/`: React 19, TypeScript, Vite, Zustand, Recharts, and a canvas goban
- `backend/`: FastAPI WebSocket API and a long-lived KataGo analysis subprocess
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

In a second terminal:

```sh
cd frontend
npm install
npm run dev
```

For a deployed frontend, set `VITE_API_URL` to the public HTTP(S) base URL of
the backend. Set `VITE_KATAGO_MODEL_VERSION` to the deployed KataGo network
identifier so cached reviews are invalidated when the model changes. Set
backend `CORS_ORIGINS` to a comma-separated list of allowed frontend origins.

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

Set `OPENAI_API_KEY` on the backend to enable the coach panel for analyzed
positions. `OPENAI_COACH_MODEL` defaults to `gpt-5-mini` and can be changed.
The coach sends only the selected position, a short move history, and bounded
KataGo candidate data to the model. It shows the underlying engine evidence
separately from the model's explanation. For an unevaluated candidate, it can
request one focused KataGo search (up to 200 visits) before answering. Exploratory
continuations are capped at four moves. This requires the local KataGo engine.
The response separates KataGo facts, the coach's teaching interpretation, and
what remains uncertain; interpretations are not engine conclusions.
The API key stays on the backend. Requests set `store: false` on the model API.

## Test

```sh
cd frontend
npm test
npm run lint
npm run build

cd ../backend
python3 -m unittest discover -s tests -v
```
