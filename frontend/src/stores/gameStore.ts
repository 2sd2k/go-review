import { create } from 'zustand';
import type { Game, GameNode, StoneColor, Point, BoardState, EditTool, BoardMarkKind } from '../types/game';
import { createEmptyBoard, createEmptyGame } from '../types/game';
import { applyMoveWithRules } from '../lib/gobanRules';
import { toggleMark } from '../lib/marks';
import {
  currentLine,
  getNode,
  leafOnCurrentLine,
  shiftBranchTarget,
  nextNode,
  playFrom,
  prevNode,
  trunkLine,
} from '../lib/moveTree';

interface GameState {
  game: Game | null;
  gameSessionId: number;
  currentNodeId: number;
  editTool: EditTool;

  loadGame: (game: Game) => void;
  goToNode: (id: number) => void;
  goToMove: (index: number) => void;
  goToTrunkMove: (moveNumber: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  shiftBranch: (delta: number) => void;
  playMove: (point: Point | 'pass') => boolean;
  setEditTool: (tool: EditTool) => void;
  toggleBoardMark: (point: Point) => void;

  currentNode: () => GameNode | null;
  currentBoard: () => BoardState;
  currentTurn: () => StoneColor;
}

export const useGameStore = create<GameState>((set, get) => ({
  game: null,
  gameSessionId: 0,
  currentNodeId: 0,
  editTool: 'play',

  loadGame: (game) => set(state => ({ game, currentNodeId: game.rootId,
    editTool: 'play', gameSessionId: state.gameSessionId + 1 })),

  goToNode: (id) => {
    const { game } = get();
    if (!game || !game.nodes[id]) return;
    set({ currentNodeId: id });
  },

  goToMove: (index) => {
    const { game, currentNodeId } = get();
    if (!game) return;
    const line = currentLine(game, currentNodeId);
    const clamped = Math.max(0, Math.min(index, line.length - 1));
    set({ currentNodeId: line[clamped].id });
  },

  goToTrunkMove: (moveNumber) => {
    const { game } = get();
    if (!game) return;
    const node = trunkLine(game).find((candidate) => candidate.moveNumber === moveNumber);
    if (node) set({ currentNodeId: node.id });
  },

  nextMove: () => {
    const { game, currentNodeId } = get();
    if (!game) return;
    const next = nextNode(game, getNode(game, currentNodeId));
    if (next) set({ currentNodeId: next.id });
  },

  prevMove: () => {
    const { game, currentNodeId } = get();
    if (!game) return;
    const stepped = prevNode(game, getNode(game, currentNodeId));
    if (stepped) set({ game: stepped.game, currentNodeId: stepped.node.id });
  },

  goToStart: () => {
    const { game } = get();
    if (!game) return;
    set({ currentNodeId: game.rootId });
  },

  goToEnd: () => {
    const { game, currentNodeId } = get();
    if (!game) return;
    set({ currentNodeId: leafOnCurrentLine(game, currentNodeId).id });
  },

  shiftBranch: (delta) => {
    const { game, currentNodeId } = get();
    if (!game || delta === 0) return;
    const neighbor = shiftBranchTarget(game, currentNodeId, delta);
    if (neighbor) set({ currentNodeId: neighbor.id });
  },

  playMove: (point) => {
    const { game, currentNodeId } = get();
    const active = game ?? createEmptyGame(19);
    const current = getNode(active, game ? currentNodeId : active.rootId);
    const color = current.nextPlayer;

    try {
      const result = applyMoveWithRules(active, current.id, { color, point });
      const played = playFrom(active, current.id, {
        move: { color, point },
        boardState: result.boardState,
        captures: result.captures,
        nextPlayer: result.nextPlayer,
      });
      set(state => ({ game: played.game, currentNodeId: played.node.id,
        gameSessionId: game ? state.gameSessionId : state.gameSessionId + 1 }));
      return true;
    } catch {
      if (!game) set({ game: active, currentNodeId: active.rootId });
      return false;
    }
  },

  setEditTool: (tool) => set({ editTool: tool }),

  toggleBoardMark: (point) => {
    const { game, currentNodeId, editTool } = get();
    if (editTool === 'play') return;
    const kind = editTool as BoardMarkKind;
    const active = game ?? createEmptyGame(19);
    const nodeId = game ? currentNodeId : active.rootId;
    const current = getNode(active, nodeId);
    const marks = toggleMark(current.marks ?? [], point, kind);
    set({
      game: {
        ...active,
        nodes: {
          ...active.nodes,
          [current.id]: { ...current, marks },
        },
      },
      currentNodeId: current.id,
    });
  },

  currentNode: () => {
    const { game, currentNodeId } = get();
    if (!game) return null;
    return game.nodes[currentNodeId] ?? null;
  },

  currentBoard: () => {
    const { game, currentNodeId } = get();
    if (!game) return createEmptyBoard(19);
    return getNode(game, currentNodeId).boardState;
  },

  currentTurn: () => {
    const { game, currentNodeId } = get();
    if (!game) return 'B';
    return getNode(game, currentNodeId).nextPlayer;
  },
}));
