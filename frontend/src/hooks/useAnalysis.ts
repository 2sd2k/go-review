import { useCallback, useRef } from 'react';
import { useAnalysisStore } from '../stores/analysisStore';
import type { Game } from '../types/game';
import { pointToDisplay } from '../lib/coordinates';

function getWebSocketUrl(): string {
  const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (configuredApiUrl) {
    const url = new URL(configuredApiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/analyze';
    url.search = '';
    return url.toString();
  }

  if (import.meta.env.DEV) return 'ws://localhost:8000/ws/analyze';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/analyze`;
}

export function useAnalysis() {
  const wsRef = useRef<WebSocket | null>(null);
  const { addResult, setAnalyzing, setProgress, setError, clear } = useAnalysisStore();

  const analyzeGame = useCallback((game: Game) => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    clear();
    setAnalyzing(true);
    setError(null);

    // Convert game moves to the format the backend expects: [["B", "D4"], ["W", "Q16"], ...]
    const moves: string[][] = [];
    for (let i = 1; i < game.nodes.length; i++) {
      const node = game.nodes[i];
      if (!node.move) continue;

      const color = node.move.color;
      const point = node.move.point === 'pass'
        ? 'pass'
        : pointToDisplay(node.move.point, game.size);

      moves.push([color, point]);
    }

    const initialStones = game.initialStones.map((stone) => [
      stone.color,
      stone.point === 'pass' ? 'pass' : pointToDisplay(stone.point, game.size),
    ]);

    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        moves,
        initial_stones: initialStones,
        rules: game.metadata.rules ?? 'chinese',
        komi: game.metadata.komi ?? 7.5,
        board_size: game.size,
        max_visits: 100,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'progress':
          setProgress(0, data.total_moves);
          break;

        case 'result':
          addResult(data.analysis);
          setProgress(data.move_number, data.total_moves);
          break;

        case 'complete':
          setAnalyzing(false);
          break;

        case 'error':
          setError(data.error);
          setAnalyzing(false);
          break;
      }
    };

    ws.onerror = () => {
      setError('Connection to analysis server failed. Is the backend running?');
      setAnalyzing(false);
    };

    ws.onclose = () => {
      setAnalyzing(false);
    };
  }, [addResult, setAnalyzing, setProgress, setError, clear]);

  const stopAnalysis = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setAnalyzing(false);
  }, [setAnalyzing]);

  return { analyzeGame, stopAnalysis };
}
