import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAnalysisStore } from '../../stores/analysisStore';
import { buildCoachEvidence } from '../../lib/coachEvidence';

interface Turn {
  question: string;
  answer: string;
  facts: string[];
}

function coachUrl(): string {
  const base = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : window.location.origin);
  return new URL('/api/coach', base).toString();
}

export default function CoachPanel() {
  const game = useGameStore(state => state.game);
  const nodeId = useGameStore(state => state.currentNodeId);
  const results = useAnalysisStore(state => state.results);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  if (!game) return null;
  const position = buildCoachEvidence(game, nodeId, results);
  if (!position) return null;

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || waiting) return;
    const controller = new AbortController();
    pending.current = controller;
    setWaiting(true);
    setError('');
    const history = turns.slice(-3).flatMap(turn => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer },
    ]);
    try {
      const response = await fetch(coachUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, position, history }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The coach could not answer.');
      setTurns(previous => [...previous, { question: trimmed, answer: data.answer, facts: data.engine_facts }]);
      setQuestion('');
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The coach could not answer.');
    } finally {
      if (!controller.signal.aborted) setWaiting(false);
      pending.current = null;
    }
  };

  const prompts = position.move_number > 0
    ? ['Why was this move bad?', 'What was better?', 'Show the tactical sequence']
    : ['Where should Black focus?', 'What are the best moves?'];

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700" aria-label="Go coach">
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Ask about move {position.move_number}</h2>
      <p className="text-xs text-gray-500 mb-2">Explanations use the KataGo analysis shown here. Tactical reasons may be uncertain.</p>
      <div className="space-y-2 max-h-72 overflow-y-auto" aria-live="polite">
        {turns.map((turn, index) => (
          <div key={index} className="text-xs rounded border border-gray-700 p-2">
            <p className="font-semibold">You: {turn.question}</p>
            <p className="mt-1 whitespace-pre-wrap">Coach: {turn.answer}</p>
            <details className="mt-1 text-gray-500">
              <summary className="cursor-pointer">Engine evidence</summary>
              <ul className="list-disc pl-4 mt-1">{turn.facts.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}</ul>
            </details>
          </div>
        ))}
      </div>
      {turns.length === 0 && <div className="flex flex-wrap gap-1 my-2">
        {prompts.map(prompt => <button key={prompt} type="button" disabled={waiting}
          onClick={() => void ask(prompt)} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600 disabled:opacity-50">
          {prompt}
        </button>)}
      </div>}
      <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="mt-2 flex gap-1">
        <label htmlFor="coach-question" className="sr-only">Question about the selected position</label>
        <input id="coach-question" value={question} onChange={event => setQuestion(event.target.value)}
          placeholder="Ask about this move…" maxLength={500} disabled={waiting}
          className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs" />
        <button type="submit" disabled={waiting || question.trim().length < 3}
          className="rounded bg-gray-700 px-2 py-1 text-xs disabled:opacity-50">{waiting ? 'Thinking…' : 'Ask'}</button>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </section>
  );
}
