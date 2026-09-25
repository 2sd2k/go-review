import { describe, expect, it } from 'vitest';
import { parseSgf } from './sgf';
import { buildCoachEvidence, buildCoachGameContext } from './coachEvidence';
import { DEFAULT_ANALYSIS_SETTINGS, type MoveAnalysis } from '../types/analysis';

describe('coach evidence', () => {
  it('uses prior candidates to explain the played move and bounds the context', () => {
    const game = parseSgf('(;GM[1]SZ[9]BR[4k];B[aa];W[bb])');
    const current = game.nodes[game.nodes[game.rootId].trunkNextId!];
    const before: MoveAnalysis = {
      move_number: 0, current_player: 'B', win_rate: 0.5, score_lead: 0,
      ownership: [], top_moves: [{ move: 'B2', win_rate: 0.6, score_lead: 2,
        visits: 100, pv: Array(20).fill('B2') }],
    };
    const after: MoveAnalysis = {
      move_number: 1, current_player: 'W', win_rate: 0.4, score_lead: -1,
      ownership: [], top_moves: [], point_loss: 3, win_rate_loss: 0.1, quality: 'mistake',
    };
    const evidence = buildCoachEvidence(game, current.id, new Map([[0, before], [1, after]]));
    expect(evidence).toMatchObject({
      played_move: 'A9', mover: 'B', point_loss: 3, player_rank: '4k',
      prior: { top_moves: [{ move: 'B2' }] },
    });
    expect(evidence?.prior?.top_moves[0].pv).toHaveLength(8);
    expect(evidence?.board_rows).toHaveLength(9);
    expect(evidence?.recent_moves).toEqual(['B A9']);
  });

  it('requires KataGo analysis for the selected trunk position', () => {
    const game = parseSgf('(;GM[1]SZ[9];B[aa])');
    expect(buildCoachEvidence(game, game.rootId, new Map())).toBeNull();
  });

  it('sends only the selected trunk prefix for a focused search', () => {
    const game = parseSgf('(;GM[1]SZ[9]AB[cc];B[aa];W[];B[bb])');
    const first = game.nodes[game.nodes[game.rootId].trunkNextId!];
    const context = buildCoachGameContext(game, first.id, { ...DEFAULT_ANALYSIS_SETTINGS, maxVisits: 500 });
    expect(context).toMatchObject({
      moves: [['B', 'A9']], initial_stones: [['B', 'C7']], board_size: 9, max_visits: 200,
    });
    expect(context?.moves).toHaveLength(1);
  });
});
