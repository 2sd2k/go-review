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
4. [x] Replace the linear move history with a visible variation tree. Playing from
   a past position must create a new timeline instead of deleting future moves;
   users must be able to see, compare, and navigate every branch. Import and
   export SGF variations and preserve comments on their original nodes.
5. [x] Finish rule correctness: carry ko state during local editing and either
   implement positional/situational superko or delegate legality to a proven Go
   board library.
6. [x] Add a clear analysis settings control: quick/deep visits, rules, komi, and
   board size.

Exit criterion: a normal or handicap SGF produces stable, reproducible labels
and every label can be traced to KataGo evidence.

## Phase 2 — The Chess.com-style review experience

1. [x] Build a review summary: best moves, mistakes, blunders, biggest turning
   point, and an accuracy-like score for each player.
2. [x] Make flagged moments the primary navigation path, with previous/next issue
   controls and the played move versus best move shown together.
3. [x] Let users play through KataGo's principal variation and branch into their
   own alternatives without changing the original game.
4. [x] Add responsive mobile/tablet layouts and accessible board controls.
5. [x] Save analysis results locally first (IndexedDB), keyed by SGF hash, KataGo
   model/version, rules, komi, and visit count so repeat reviews are instant.
6. [x] Redesign the interface with an Online-Go.com-inspired aesthetic: primarily
   black, white, and restrained neutral grays; remove the current purple tint
   and decorative gradients while preserving clear move-quality indicators.

Exit criterion: a user can upload a game and understand the three most
important lessons without reading raw engine numbers.

## Phase 3A — Local import and game history (complete)

1. [x] Import a public OGS game by URL or ID through a fixed-host backend route
   with timeout, size limit, and private-game/rate-limit errors. Private games
   can be imported through a manual SGF upload.
2. [x] Upload or drag and drop an SGF file, with size and read errors, and
   download an SGF copy of the game and its variations.
3. [x] Save, reopen, find, rename, and delete reviews locally without an account.
   Autosave edits and restore the selected move or variation after reopening.
4. [x] Keep the original SGF separate from edited variations, settings, and
   derived analysis in the browser's IndexedDB saved-review library.

Exit criterion met: users can revisit prior reviews and import a public OGS
game from its URL in one step.

## Phase 3B — Cloud sync and account-linked history (pending)

1. [ ] Verify SGF imports against encoding fixtures from OGS, KGS, Fox, Tygem,
   Pandanet, and desktop editors so manual upload remains a reliable fallback.
2. [ ] Configure a real Supabase project and verify email-link sign-in end to
   end. The frontend and backend auth integration exists, but live verification
   is still part of Phase 5.4.
3. [ ] Link saved games, review history, and player preferences to an account;
   sync them across devices while preserving the existing local library.
4. [ ] Store original SGFs in object storage and game, position, job, and
   annotation records in a relational database suitable for deployment. The
   current IndexedDB library and single-host SQLite job queue are local
   foundations, not cloud persistence.

Exit criterion: a signed-in user can reopen a saved review on another device,
with its original SGF and derived analysis kept distinct.

## Phase 4 — Conversational coach

Do not ask KataGo to generate prose; it is an evaluator, not a language model.
Use an LLM as the explanation layer and give it structured, bounded evidence:
the position, played move, candidate moves, score/win-rate deltas, ownership
changes, principal variations, game metadata, and the user's rank.

1. [x] Start with position-scoped questions: “Why is this bad?”, “Why not R17?”,
   “Where should Black focus?”, and “Show the tactical sequence.”
2. [x] Give the LLM tools to request extra KataGo analysis for a proposed move or a
   deeper variation rather than letting it invent evaluations.
3. [x] Require explanations to distinguish engine facts from teaching heuristics.
4. [x] Add rank-aware explanations and concise/technical modes.
5. [x] Protect the single-process coach prototype with bounded requests,
   output/tool budgets, temporary per-client and global limits, and usage plus
   exact-repeat telemetry. Add an answer cache only if measured repeats justify
   it; distinct Go positions make a broad position cache a poor default.
   Authenticated per-user quotas are still required before a public launch.
6. [x] Keep the chat panel visible before analysis and preserve each main-line
   move's conversation while navigating the open game.

Exit criterion: answers are grounded in engine output, reproducible, and useful
without claiming that KataGo itself speaks natural language.

## Phase 5 — Production architecture

1. [x] Move full-game analysis into queued jobs. The API and a separate KataGo
   worker now share a bounded SQLite queue on one host. A distributed broker
   will be needed before scaling across hosts.
2. [x] Run one or more warm GPU workers, enforce per-job limits, prioritize
   interactive queries, and terminate engine work on cancellation. Focused
   coach searches now share the worker queue and get higher KataGo priority;
   cancelled searches no longer restart the shared engine.
3. [x] Stream job events over WebSocket and persist partial progress so
   reconnects work. Rejoining a job replays its saved events; a disconnected
   socket no longer cancels the job, while Stop explicitly does.
4. Add authentication and shared per-user quotas (replacing prototype IP limits),
   structured logs, metrics, error reporting,
   health/readiness checks, and abuse controls.
   Backend and frontend Supabase email-link integration, per-user SQLite quotas,
   job ownership, request IDs, route metrics, and readiness checks are built.
   Keep this open until a real Supabase project is configured and the flow is
   verified end-to-end; hosted error reporting and multi-host quota storage
   remain future deployment work.
5. [x] Pin Python 3.13, upgrade backend dependencies, and lock the full
   cross-platform dependency set with hashes. CI installs from the lock with
   hash verification. Local Python 3.9 environments need a new 3.13 venv.
6. [x] Split the frontend bundle: load SGF parsing/export (including its
   optional encoding support) only when needed, and load the win-rate graph
   only after analysis exists. The initial JavaScript chunk fell from about
   1.54 MB to 596 KB before compression; further board-engine splitting can
   be considered if startup measurements justify it.

## Near-term technical backlog

- [x] Give every pending KataGo query a submission-time deadline, reject all
  pending requests on engine exit, and bound game-query pipe writes. Wait for
  final (not intermediate) protocol responses and reject `noResults`.
- [x] Send KataGo termination requests when a WebSocket client cancels.
- [x] Consume and retain bounded KataGo stderr output for diagnostics.
- Use engine-returned turn numbers and complete results in arrival order.
- Avoid retaining ownership arrays for every move unless the UI needs them.
- [x] Run frontend lint/build, backend tests, and mocked subprocess protocol
  tests in CI. Keep the real-model smoke test optional because it is
  hardware-specific.
- [x] Initialize this folder as its own Git repository and connect it to GitHub.
