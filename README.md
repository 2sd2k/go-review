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
the backend. Set backend `CORS_ORIGINS` to a comma-separated list of allowed
frontend origins.

See [ROADMAP.md](./ROADMAP.md) for the recommended build sequence.
