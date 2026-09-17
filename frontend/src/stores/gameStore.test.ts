import { beforeEach, describe, expect, it } from 'vitest';
import { parseSgf } from '../lib/sgf';
import { childIds, getNode, trunkLine } from '../lib/moveTree';
import { useGameStore } from './gameStore';

describe('gameStore variations', () => {
  beforeEach(() => {
    useGameStore.setState({ game: null, currentNodeId: 0, editTool: 'play' });
  });

  it('creates a new timeline instead of deleting future moves', () => {
    useGameStore.getState().loadGame(parseSgf('(;FF[4]GM[1]SZ[9];B[dd];W[ee];B[ff])'));
    useGameStore.getState().goToStart();
    useGameStore.getState().nextMove();
    const afterBlack = useGameStore.getState().currentNodeId;

    useGameStore.getState().playMove([6, 6]);

    const game = useGameStore.getState().game!;
    const black = getNode(game, afterBlack);
    expect(childIds(black)).toHaveLength(2);
    expect(trunkLine(game)).toHaveLength(4);
    expect(getNode(game, black.trunkNextId!).move).toEqual({ color: 'W', point: [4, 4] });
    expect(useGameStore.getState().currentNode()?.trunk).toBe(false);
  });

  it('navigates to an existing child when the same point is replayed', () => {
    useGameStore.getState().loadGame(parseSgf('(;FF[4]GM[1]SZ[9];B[dd];W[ee])'));
    useGameStore.getState().goToStart();
    useGameStore.getState().playMove([3, 3]);
    expect(useGameStore.getState().currentNode()?.move).toEqual({ color: 'B', point: [3, 3] });
    expect(trunkLine(useGameStore.getState().game!)).toHaveLength(3);
  });

  it('toggles marks on the current node without playing a stone', () => {
    useGameStore.getState().loadGame(parseSgf('(;FF[4]GM[1]SZ[9];B[dd])'));
    useGameStore.getState().setEditTool('triangle');
    useGameStore.getState().toggleBoardMark([1, 1]);

    expect(useGameStore.getState().currentNode()?.marks).toEqual([
      { kind: 'triangle', point: [1, 1] },
    ]);
    expect(useGameStore.getState().currentNode()?.move).toBeNull();

    useGameStore.getState().setEditTool('circle');
    useGameStore.getState().toggleBoardMark([1, 1]);
    expect(useGameStore.getState().currentNode()?.marks).toEqual([
      { kind: 'circle', point: [1, 1] },
    ]);

    useGameStore.getState().toggleBoardMark([1, 1]);
    expect(useGameStore.getState().currentNode()?.marks).toEqual([]);
  });
});
