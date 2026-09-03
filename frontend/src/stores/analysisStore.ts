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

      // Classify the move quality
      const prevAnalysis = newResults.get(analysis.move_number - 1);
      if (analysis.move_number > 0) {
        const { quality, winRateLoss, pointLoss, impactScore } = classifyMove(prevAnalysis, analysis);
        analysis.quality = quality;
        analysis.win_rate_loss = winRateLoss;
        analysis.point_loss = pointLoss;
        analysis.impact_score = impactScore;
      }

      newResults.set(analysis.move_number, analysis);
      return { results: newResults };
    });
  },

  setAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),

  setProgress: (progress, total) => set({ progress, totalMoves: total }),

  setError: (error) => set({ error }),

  clear: () => set({ results: new Map(), progress: 0, totalMoves: 0, error: null }),

  getAnalysis: (moveNumber) => get().results.get(moveNumber),
}));
