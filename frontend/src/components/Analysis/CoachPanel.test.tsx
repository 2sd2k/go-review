import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachPanelContent } from './CoachPanel';
import { parseSgf } from '../../lib/sgf';
import { DEFAULT_ANALYSIS_SETTINGS, type MoveAnalysis } from '../../types/analysis';
import type { Game } from '../../types/game';

function renderCoach(game: Game | null, nodeId = game?.rootId ?? 0, results = new Map<number, MoveAnalysis>()) {
  return renderToStaticMarkup(<CoachPanelContent game={game} nodeId={nodeId}
    results={results} settings={DEFAULT_ANALYSIS_SETTINGS} />);
}

describe('coach panel visibility', () => {
  it('shows how to start before a game is loaded', () => {
    const html = renderCoach(null);
    expect(html).toContain('Chat with the Go coach');
    expect(html).toContain('Play a game or upload an SGF');
    expect(html).toContain('disabled');
    expect(html).toContain('Ask about this move');
  });

  it('shows an analysis prerequisite instead of disappearing', () => {
    const game = parseSgf('(;GM[1]SZ[9];B[aa])');
    const firstMoveId = game.nodes[game.rootId].trunkNextId!;

    expect(renderCoach(game, firstMoveId)).toContain('Analyze the game to ask about move 1');
  });

  it('shows a question input for an analyzed move', () => {
    const game = parseSgf('(;GM[1]SZ[9];B[aa])');
    const firstMoveId = game.nodes[game.rootId].trunkNextId!;
    const analysis: MoveAnalysis = {
      move_number: 1, current_player: 'W', win_rate: 0.5, score_lead: 0,
      ownership: [], top_moves: [],
    };
    const html = renderCoach(game, firstMoveId, new Map([[1, analysis]]));
    expect(html).toContain('Ask about move 1');
    expect(html).toContain('Question about the selected position');
    expect(html).toContain('Ask about this move');
  });

  it('explains why questions are unavailable on a variation', () => {
    const game = parseSgf('(;GM[1]SZ[9];B[aa](;W[bb])(;W[cc]))');
    const firstMove = game.nodes[game.rootId].trunkNextId!;
    const branchId = game.nodes[firstMove].branchIds[0];

    expect(renderCoach(game, branchId)).toContain('Coach questions currently support main-line moves');
  });
});
