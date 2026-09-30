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
import {
  clearActiveAnalysis, createAnalysisJobId, getActiveAnalysis, saveActiveAnalysis,
} from '../lib/analysisSession';
import { authConfigured, getAccessToken } from '../lib/auth';

const MAX_RECONNECT_ATTEMPTS = 5;

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || (import.meta.env.DEV
    ? 'http://localhost:8000' : window.location.origin);
}

function getWebSocketUrl(): string {
  const url = new URL(getApiBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/analyze';
  url.search = '';
  return url.toString();
}

async function cancelJob(jobId: string): Promise<void> {
  const token = await getAccessToken();
  if (authConfigured && !token) throw new Error('Sign in to cancel analysis.');
  const url = new URL(getApiBaseUrl());
  url.pathname = `/api/analysis/jobs/${jobId}`;
  url.search = '';
  // Stop may race with the first WebSocket submission. Give the server a
  // moment to create the known job before treating 404 as already stopped.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(url, {
      method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.ok) return;
    if (response.status !== 404) throw new Error('Analysis cancellation failed');
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export function useAnalysis() {
  const wsRef = useRef<WebSocket | null>(null);
  const jobRef = useRef<string | null>(null);
  const cacheKeyRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisRunRef = useRef(0);
  const { addResult, setResults, setAnalyzing, setProgress, setError, clear } = useAnalysisStore();

  const analyzeGame = useCallback(async (game: Game, settings: AnalysisSettings) => {
    const runId = ++analysisRunRef.current;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    wsRef.current?.close();

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
      const previous = getActiveAnalysis();
      if (previous?.cacheKey === cacheKey) clearActiveAnalysis(previous.jobId);
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
    const saved = getActiveAnalysis();
    const jobId = saved?.cacheKey === cacheKey ? saved.jobId
      : cacheKeyRef.current === cacheKey && jobRef.current ? jobRef.current
        : createAnalysisJobId();
    jobRef.current = jobId;
    cacheKeyRef.current = cacheKey;
    saveActiveAnalysis({ cacheKey, jobId });

    const request = {
      job_id: jobId,
      moves,
      initial_stones: initialStones,
      rules: settings.rules,
      komi: settings.komi,
      board_size: game.size,
      max_visits: settings.maxVisits,
    };
    let retries = 0;
    const connect = () => {
      if (runId !== analysisRunRef.current) return;
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;
      let finished = false;

      ws.onopen = async () => {
        try {
          const token = await getAccessToken();
          if (runId !== analysisRunRef.current || ws.readyState !== WebSocket.OPEN) return ws.close();
          if (authConfigured && !token) throw new Error('Sign in to analyze this game.');
          ws.send(JSON.stringify({ ...request, ...(token ? { access_token: token } : {}) }));
        } catch (error) {
          finished = true;
          clearActiveAnalysis(jobId);
          jobRef.current = null;
          cacheKeyRef.current = null;
          setError(error instanceof Error ? error.message : 'Sign-in failed.');
          setAnalyzing(false);
          ws.close();
        }
      };

      ws.onmessage = (event) => {
        if (runId !== analysisRunRef.current || wsRef.current !== ws) return;
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'progress':
            retries = 0;
            setError(null);
            setProgress(Math.max(useAnalysisStore.getState().progress, data.move_number), data.total_moves);
            break;
          case 'result':
            addResult(data.analysis);
            setProgress(Math.min(data.total_moves, Math.max(
              useAnalysisStore.getState().progress,
              useAnalysisStore.getState().results.size - 1,
            )), data.total_moves);
            break;
          case 'complete':
            finished = true;
            clearActiveAnalysis(jobId);
            jobRef.current = null;
            cacheKeyRef.current = null;
            setAnalyzing(false);
            void saveCachedAnalysis({
              ...cacheIdentity,
              key: cacheKey,
              totalMoves: data.total_moves ?? 0,
              results: Array.from(useAnalysisStore.getState().results.entries()),
              createdAt: Date.now(),
            });
            ws.close();
            break;
          case 'error':
          case 'cancelled':
            finished = true;
            clearActiveAnalysis(jobId);
            jobRef.current = null;
            cacheKeyRef.current = null;
            setError(data.error ?? 'Analysis was cancelled.');
            setAnalyzing(false);
            ws.close();
            break;
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (runId !== analysisRunRef.current || finished || wsRef.current !== ws) return;
        if (++retries > MAX_RECONNECT_ATTEMPTS) {
          setError('Connection lost. Click Analyze Game to resume this review.');
          setAnalyzing(false);
          return;
        }
        setError('Connection lost. Reconnecting to analysis…');
        retryTimerRef.current = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 5000));
      };
    };
    connect();
  }, [addResult, setResults, setAnalyzing, setProgress, setError, clear]);

  const stopAnalysis = useCallback(async () => {
    analysisRunRef.current += 1;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const jobId = jobRef.current ?? getActiveAnalysis()?.jobId;
    if (jobId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel', job_id: jobId }));
    }
    wsRef.current?.close();
    wsRef.current = null;
    jobRef.current = null;
    cacheKeyRef.current = null;
    if (jobId) {
      clearActiveAnalysis(jobId);
    }
    setAnalyzing(false);
    if (jobId) {
      await cancelJob(jobId).catch(() => setError('Could not cancel analysis on the server.'));
    }
  }, [setAnalyzing, setError]);

  return { analyzeGame, stopAnalysis };
}
