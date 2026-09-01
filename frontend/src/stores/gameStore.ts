import { create } from 'zustand';
import type { Game, GameNode, StoneColor, Point, BoardState } from '../types/game';
import { createEmptyBoard } from '../types/game';
import { applyMove } from '../lib/goLogic';

interface GameState {
  game: Game | null;
  currentMoveIndex: number;

  // Actions
  loadGame: (game: Game) => void;
  goToMove: (index: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // Play a move on the board (for manual stone placement)
  playMove: (point: Point) => void;

  // Computed
  currentNode: () => GameNode | null;
  currentBoard: () => BoardState;
  currentTurn: () => StoneColor;
}

export const useGameStore = create<GameState>((set, get) => ({
  game: null,
  currentMoveIndex: 0,

  loadGame: (game) => set({ game, currentMoveIndex: 0 }),

  goToMove: (index) => {
    const { game } = get();
    if (!game) return;
    const clamped = Math.max(0, Math.min(index, game.nodes.length - 1));
    set({ currentMoveIndex: clamped });
  },

  nextMove: () => {
    const { game, currentMoveIndex } = get();
    if (!game) return;
    if (currentMoveIndex < game.nodes.length - 1) {
      set({ currentMoveIndex: currentMoveIndex + 1 });
    }
  },

  prevMove: () => {
    const { currentMoveIndex } = get();
    if (currentMoveIndex > 0) {
      set({ currentMoveIndex: currentMoveIndex - 1 });
    }
  },

  goToStart: () => set({ currentMoveIndex: 0 }),

  goToEnd: () => {
    const { game } = get();
    if (!game) return;
    set({ currentMoveIndex: game.nodes.length - 1 });
  },

  playMove: (point) => {
    const { game, currentMoveIndex } = get();
    if (!game) {
      // No game loaded — start a new one
      const size = 19;
      const emptyBoard = createEmptyBoard(size);
      const rootNode: GameNode = {
        move: null,
        boardState: emptyBoard,
        moveNumber: 0,
        captures: { black: 0, white: 0 },
        nextPlayer: 'B',
      };

      const color: StoneColor = 'B';
      try {
        const result = applyMove(emptyBoard, point, color);
        const newNode: GameNode = {
          move: { color, point },
          boardState: result.board,
          moveNumber: 1,
          captures: { black: result.captured.length, white: 0 },
          nextPlayer: 'W',
        };

        const newGame: Game = {
          size,
          nodes: [rootNode, newNode],
          metadata: {},
          initialStones: [],
        };
        set({ game: newGame, currentMoveIndex: 1 });
      } catch {
        // Illegal move — ignore
      }
      return;
    }

    // Game exists — add a move after current position
    const currentNode = game.nodes[currentMoveIndex];
    const currentBoard = currentNode.boardState;
    const moveNumber = currentMoveIndex + 1;
    const color = currentNode.nextPlayer;

    try {
      const result = applyMove(currentBoard, point, color);
      const prevCaptures = currentNode.captures;
      const newCaptures = {
        black: prevCaptures.black + (color === 'B' ? result.captured.length : 0),
        white: prevCaptures.white + (color === 'W' ? result.captured.length : 0),
      };

      const newNode: GameNode = {
        move: { color, point },
        boardState: result.board,
        moveNumber,
        captures: newCaptures,
        nextPlayer: color === 'B' ? 'W' : 'B',
      };

      // Truncate any future moves and append
      const newNodes = [...game.nodes.slice(0, currentMoveIndex + 1), newNode];
      const newGame: Game = { ...game, nodes: newNodes };
      set({ game: newGame, currentMoveIndex: newNodes.length - 1 });
    } catch {
      // Illegal move — ignore
    }
  },

  currentNode: () => {
    const { game, currentMoveIndex } = get();
    if (!game) return null;
    return game.nodes[currentMoveIndex];
  },

  currentBoard: () => {
    const { game, currentMoveIndex } = get();
    if (!game) return createEmptyBoard(19);
    return game.nodes[currentMoveIndex].boardState;
  },

  currentTurn: () => {
    const { game, currentMoveIndex } = get();
    return game?.nodes[currentMoveIndex]?.nextPlayer ?? 'B';
  },
}));
