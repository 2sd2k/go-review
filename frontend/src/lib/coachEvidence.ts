import type { Game } from '../types/game';
import type { MoveAnalysis, SuggestedMove } from '../types/analysis';
import { ancestors } from './moveTree';
import { pointToDisplay } from './coordinates';

function candidate(move: SuggestedMove) {
  return {
    move: move.move,
    win_rate: move.win_rate,
    score_lead: move.score_lead,
    visits: move.visits,
    pv: move.pv.slice(0, 8),
  };
}

function snapshot(analysis: MoveAnalysis) {
  return {
    win_rate: analysis.win_rate,
    score_lead: analysis.score_lead,
    top_moves: analysis.top_moves.slice(0, 3).map(candidate),
  };
}

/** Include only the selected trunk position and bounded, relevant engine data. */
export function buildCoachEvidence(game: Game, nodeId: number, results: Map<number, MoveAnalysis>) {
  const node = game.nodes[nodeId];
  if (!node?.trunk) return null;
  const current = results.get(node.moveNumber);
  if (!current) return null;
  const prior = node.moveNumber > 0 ? results.get(node.moveNumber - 1) : undefined;
  const recent_moves = ancestors(game, nodeId).slice(-12).flatMap(ancestor => {
    if (!ancestor.move) return [];
    const point = ancestor.move.point === 'pass' ? 'pass' : pointToDisplay(ancestor.move.point, game.size);
    return [`${ancestor.move.color} ${point}`];
  });
  const played_move = node.move?.point === 'pass' ? 'pass'
    : node.move ? pointToDisplay(node.move.point, game.size) : null;
  const mover = node.move?.color ?? null;
  return {
    move_number: node.moveNumber,
    board_size: game.size,
    board_rows: node.boardState.map(row => row.map(stone => stone ?? '.').join('')),
    next_player: node.nextPlayer,
    mover,
    played_move,
    quality: current.quality ?? null,
    win_rate_loss: current.win_rate_loss ?? null,
    point_loss: current.point_loss ?? null,
    prior: prior ? snapshot(prior) : null,
    current: snapshot(current),
    recent_moves,
    player_rank: mover === 'B' ? game.metadata.blackRank ?? null
      : mover === 'W' ? game.metadata.whiteRank ?? null : null,
  };
}
