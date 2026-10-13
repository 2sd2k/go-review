import { create } from 'zustand';
import type { MoveAnalysis } from '../types/analysis';
import { classifyMove } from '../lib/moveClassifier';

interface AnalysisState {
  results: Map<number, MoveAnalysis>; // moveNumber -> analysis
  isAnalyzing: boolean;
  progress: number; // 0-1
  totalMoves: number;
  error: string | null;

  // Actions
  addResult: (analysis: MoveAnalysis) => void;
  setResults: (results: Map<number, MoveAnalysis>) => void;
  setAnalyzing: (analyzing: boolean) => void;
  setProgress: (progress: number, total: number) => void;
  setError: (error: string | null) => void;
  clear: () => void;

  // Computed
  getAnalysis: (moveNumber: number) => MoveAnalysis | undefined;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  results: new Map(),
  isAnalyzing: false,
  progress: 0,
  totalMoves: 0,
  error: null,

  addResult: (analysis) => {
    set((state) => {
      const newResults = new Map(state.results);

      const classify = (current: MoveAnalysis, previous: MoveAnalysis): MoveAnalysis => {
        // Losses computed by an earlier frontend fallback must not be mistaken
        // for a direct KataGo comparison when a replay replaces a position.
        const source = current.played_move && current.best_move ? current : {
          ...current, win_rate_loss: undefined, point_loss: undefined,
        };
        const { quality, winRateLoss, pointLoss, impactScore } = classifyMove(previous, source);
        return {
          ...current, quality, win_rate_loss: winRateLoss,
          point_loss: pointLoss, impact_score: impactScore,
        };
      };

      const previous = newResults.get(analysis.move_number - 1);
      newResults.set(analysis.move_number,
        analysis.move_number > 0 && previous ? classify(analysis, previous) : { ...analysis });

      // KataGo may finish the successor before this position. Classify it as
      // soon as its missing predecessor arrives (or is replayed).
      const successor = newResults.get(analysis.move_number + 1);
      if (successor) {
        newResults.set(analysis.move_number + 1,
          classify(successor, newResults.get(analysis.move_number)!));
      }
      return { results: newResults };
    });
  },

  setResults: (results) => set({ results: new Map(results) }),

  setAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),

  setProgress: (progress, total) => set({ progress, totalMoves: total }),

  setError: (error) => set({ error }),

  clear: () => set({ results: new Map(), progress: 0, totalMoves: 0, error: null }),

  getAnalysis: (moveNumber) => get().results.get(moveNumber),
}));
