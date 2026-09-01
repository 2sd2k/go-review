export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface SuggestedMove {
  move: string; // e.g. "Q16" or "pass"
  win_rate: number;
  score_lead: number;
  visits: number;
  pv: string[]; // principal variation
}

export interface MoveAnalysis {
  move_number: number;
  current_player: string; // "B" or "W"
  win_rate: number; // from black's perspective, 0-1
  score_lead: number; // positive = black leads
  top_moves: SuggestedMove[];
  ownership: number[]; // 361 values, -1 (white) to 1 (black)
  // Added by frontend after classification
  quality?: MoveQuality;
  win_rate_loss?: number;
}
