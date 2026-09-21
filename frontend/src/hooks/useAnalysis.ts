import { useCallback, useRef } from 'react';
import { useAnalysisStore } from '../stores/analysisStore';
import type { Game } from '../types/game';
import type { AnalysisSettings } from '../types/analysis';
import { pointToDisplay } from '../lib/coordinates';
import { exportSgf } from '../lib/sgf';
import {
  getCachedAnalysis,
  hashText,
  KATAGO_MODEL_VERSION,
  makeAnalysisCacheKey,
  saveCachedAnalysis,
} from '../lib/analysisCache';

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
  const analysisRunRef = useRef(0);
  const { addResult, setResults, setAnalyzing, setProgress, setError, clear } = useAnalysisStore();

  const analyzeGame = useCallback(async (game: Game, settings: AnalysisSettings) => {
    const runId = ++analysisRunRef.current;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    clear();
    setAnalyzing(true);
    setError(null);

    const sgfHash = await hashText(exportSgf(game));
    if (runId !== analysisRunRef.current) return;
    const cacheIdentity = {
      sgfHash,
      modelVersion: KATAGO_MODEL_VERSION,
      rules: settings.rules,
      komi: settings.komi,
      maxVisits: settings.maxVisits,
      boardSize: game.size,
    };
    const cacheKey = makeAnalysisCacheKey(cacheIdentity);
    const cached = await getCachedAnalysis(cacheKey);
    if (runId !== analysisRunRef.current) return;
    if (cached) {
      setResults(new Map(cached.results));
      setProgress(cached.totalMoves, cached.totalMoves);
      setAnalyzing(false);
      return;
    }

    // Convert the official (trunk) line to the format the backend expects.
    const moves: string[][] = [];
    let node = game.nodes[game.rootId];
    while (node.trunkNextId != null) {
      node = game.nodes[node.trunkNextId];
      if (!node?.move) continue;

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
        rules: settings.rules,
        komi: settings.komi,
        board_size: game.size,
        max_visits: settings.maxVisits,
      }));
    };

    ws.onmessage = (event) => {
      if (runId !== analysisRunRef.current) return;
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
          void saveCachedAnalysis({
            ...cacheIdentity,
            key: cacheKey,
            totalMoves: data.total_moves ?? 0,
            results: Array.from(useAnalysisStore.getState().results.entries()),
            createdAt: Date.now(),
          });
          break;

        case 'error':
          setError(data.error);
          setAnalyzing(false);
          break;
      }
    };

    ws.onerror = () => {
      if (runId !== analysisRunRef.current) return;
      setError('Connection to analysis server failed. Is the backend running?');
      setAnalyzing(false);
    };

    ws.onclose = () => {
      if (runId !== analysisRunRef.current) return;
      setAnalyzing(false);
    };
  }, [addResult, setResults, setAnalyzing, setProgress, setError, clear]);

  const stopAnalysis = useCallback(() => {
    analysisRunRef.current += 1;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setAnalyzing(false);
  }, [setAnalyzing]);

  return { analyzeGame, stopAnalysis };
}
