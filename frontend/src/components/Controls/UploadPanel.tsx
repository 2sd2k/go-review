import { useCallback, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { parseSgf } from '../../lib/sgf';
import { useAnalysisStore } from '../../stores/analysisStore';

export default function UploadPanel() {
  const { loadGame } = useGameStore();
  const clearAnalysis = useAnalysisStore((state) => state.clear);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const game = parseSgf(text);
          clearAnalysis();
          loadGame(game);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse SGF file');
        }
      };
      reader.readAsText(file);
    },
    [clearAnalysis, loadGame]
  );

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
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
