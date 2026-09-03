# Product roadmap

The product promise is: after a game, show the few moments that mattered, make
the alternatives easy to explore, and explain them at the player's level.

## Phase 1 — Trustworthy review MVP

1. [x] Add automated tests for captures, suicide, ko, passes, handicap setup,
   malformed SGF, coordinate conversion, and move classification.
2. [x] Replace fixed win-rate thresholds with a blended score-loss/win-rate model.
   Score loss matters more in handicap games and when win rate is already near
   0% or 100%.
3. [x] Analyze the played move directly, not only the post-move root position, and
   store point loss, win-rate loss, best move, visits, and principal variation.
4. Replace the linear move history with a visible variation tree. Playing from
   a past position must create a new timeline instead of deleting future moves;
   users must be able to see, compare, and navigate every branch. Import and
   export SGF variations and preserve comments on their original nodes.
5. Finish rule correctness: carry ko state during local editing and either
   implement positional/situational superko or delegate legality to a proven Go
   board library.
6. Add a clear analysis settings control: quick/deep visits, rules, komi, and
   board size.

Exit criterion: a normal or handicap SGF produces stable, reproducible labels
and every label can be traced to KataGo evidence.

## Phase 2 — The Chess.com-style review experience

1. Build a review summary: best moves, mistakes, blunders, biggest turning
   point, and an accuracy-like score for each player.
2. Make flagged moments the primary navigation path, with previous/next issue
   controls and the played move versus best move shown together.
3. Let users play through KataGo's principal variation and branch into their
   own alternatives without changing the original game.
4. Add responsive mobile/tablet layouts and accessible board controls.
5. Save analysis results locally first (IndexedDB), keyed by SGF hash, KataGo
   model/version, rules, komi, and visit count so repeat reviews are instant.
6. Redesign the interface with an Online-Go.com-inspired aesthetic: primarily
   black, white, and restrained neutral grays; remove the current purple tint
   and decorative gradients while preserving clear move-quality indicators.

Exit criterion: a user can upload a game and understand the three most
important lessons without reading raw engine numbers.

## Phase 3 — Import and game history

1. Add an “Import OGS game” field accepting a game URL or ID. Public games can
   be fetched through OGS's SGF endpoint; private games should continue through
   manual file upload unless the user explicitly connects an account.
2. Keep drag-and-drop SGF as the universal import path for OGS, KGS, Fox,
   Tygem, Pandanet, and desktop editors.
3. Add accounts only when persistence is valuable: saved games, review history,
   player preferences, and usage limits.
4. Store original SGF separately from derived analysis. Use object storage for
   SGFs and a relational database for games, positions, jobs, and annotations.

Exit criterion: users can revisit prior reviews and import an OGS game from its
URL in one step.

## Phase 4 — Conversational coach

Do not ask KataGo to generate prose; it is an evaluator, not a language model.
Use an LLM as the explanation layer and give it structured, bounded evidence:
the position, played move, candidate moves, score/win-rate deltas, ownership
changes, principal variations, game metadata, and the user's rank.

1. Start with position-scoped questions: “Why is this bad?”, “Why not R17?”,
   “Where should Black focus?”, and “Show the tactical sequence.”
2. Give the LLM tools to request extra KataGo analysis for a proposed move or a
   deeper variation rather than letting it invent evaluations.
3. Require explanations to distinguish engine facts from teaching heuristics.
4. Add rank-aware explanations and concise/technical modes.
5. Cache answers by position plus question intent, with per-user rate limits and
   token budgets.

Exit criterion: answers are grounded in engine output, reproducible, and useful
without claiming that KataGo itself speaks natural language.

## Phase 5 — Production architecture

1. Move analysis into queued jobs. A web process should not own the only KataGo
   subprocess once multiple users are supported.
2. Run one or more warm GPU workers, enforce per-job limits, prioritize
   interactive queries, and terminate engine work on cancellation.
3. Stream job events over WebSocket or server-sent events and persist partial
   progress so reconnects work.
4. Add authentication, quotas, structured logs, metrics, error reporting,
   health/readiness checks, and abuse controls.
5. Pin a supported Python version, then upgrade and lock backend dependencies
   with hashes. The current local Python 3.9 runtime is too old for several
   current package releases.
6. Split the frontend bundle and keep optional SGF encoding support out of the
   initial browser chunk.

## Near-term technical backlog

- Add timeouts and engine-death propagation for every pending KataGo request.
- Send KataGo termination requests when a WebSocket client cancels.
- Consume and retain bounded KataGo stderr output for diagnostics.
- Use engine-returned turn numbers and complete results in arrival order.
- Avoid retaining ownership arrays for every move unless the UI needs them.
- Add CI for frontend lint/build, backend tests, and one mocked engine protocol
  test; keep the real-model smoke test optional because it is hardware-specific.
- [x] Initialize this folder as its own Git repository and connect it to GitHub.
