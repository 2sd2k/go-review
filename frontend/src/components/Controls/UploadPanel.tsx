import { useCallback, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { exportSgf, parseSgf } from '../../lib/sgf';
import { useAnalysisStore } from '../../stores/analysisStore';
import type { Game } from '../../types/game';
import { fetchOgsSgf } from '../../lib/ogs';

interface UploadPanelProps {
  onGameLoaded?: (game: Game) => void;
}

export default function UploadPanel({ onGameLoaded }: UploadPanelProps) {
  const { game, loadGame } = useGameStore();
  const clearAnalysis = useAnalysisStore((state) => state.clear);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRun = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ogsInput, setOgsInput] = useState('');
  const [isImportingOgs, setIsImportingOgs] = useState(false);

  const handleSgf = useCallback(
    (text: string) => {
      const parsed = parseSgf(text);
      parsed.originalSgf = text;
      clearAnalysis();
      loadGame(parsed);
      onGameLoaded?.(parsed);
    },
    [clearAnalysis, loadGame, onGameLoaded]
  );

  const handleFile = useCallback(
    (file: File) => {
      const run = ++importRun.current;
      setIsImportingOgs(false);
      setError(null);
      if (file.size > 5 * 1024 * 1024) {
        setError('SGF files must be 5 MB or smaller.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        if (run !== importRun.current) return;
        try {
          const text = e.target?.result as string;
          handleSgf(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse SGF file');
        }
      };
      reader.readAsText(file);
      reader.onerror = () => setError('Could not read this file. Please try again.');
    },
    [handleSgf]
  );

  const handleOgsImport = useCallback(async () => {
    const run = ++importRun.current;
    setError(null);
    setIsImportingOgs(true);
    try {
      const sgf = await fetchOgsSgf(ogsInput);
      if (run !== importRun.current) return;
      handleSgf(sgf);
      setOgsInput('');
    } catch (err) {
      if (run !== importRun.current) return;
      setError(err instanceof Error ? err.message : 'Failed to import the OGS game');
    } finally {
      if (run === importRun.current) setIsImportingOgs(false);
    }
  }, [handleSgf, ogsInput]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-uploaded
      e.target.value = '';
    },
    [handleFile]
  );

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload an SGF file"
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors
          ${dragOver
            ? 'border-amber-400 bg-amber-400/10'
            : 'border-gray-600 hover:border-gray-500 hover:bg-gray-700/30'
          }`}
      >
        <p className="text-xs text-gray-400">
          {dragOver ? 'Drop SGF file here' : 'Drop SGF or click to upload'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sgf"
          aria-label="Choose SGF file"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void handleOgsImport(); }} className="mt-2">
        <label htmlFor="ogs-game" className="sr-only">OGS game ID or public URL</label>
        <div className="flex gap-1">
          <input
            id="ogs-game"
            type="text"
            value={ogsInput}
            onChange={(event) => setOgsInput(event.target.value)}
            placeholder="OGS game ID or URL"
            className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            disabled={isImportingOgs}
          />
          <button
            type="submit"
            disabled={isImportingOgs || !ogsInput.trim()}
            className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImportingOgs ? 'Loading…' : 'Import OGS'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">Public games only; private games can be uploaded as SGF.</p>
      </form>
      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}
      {game && (
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([exportSgf(game)], { type: 'application/x-go-sgf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'game.sgf';
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="mt-1 w-full px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
        >
          Download SGF
        </button>
      )}
    </div>
  );
}
