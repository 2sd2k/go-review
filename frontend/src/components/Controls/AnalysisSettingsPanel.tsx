import type { AnalysisRules, AnalysisSettings } from '../../types/analysis';

interface AnalysisSettingsPanelProps {
  settings: AnalysisSettings;
  hasGame: boolean;
  onChange: (settings: AnalysisSettings) => void;
  onCreateBoard: () => void;
}

const RULE_OPTIONS: Array<{ value: AnalysisRules; label: string }> = [
  { value: 'chinese', label: 'Chinese' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'aga', label: 'AGA' },
  { value: 'korean', label: 'Korean' },
  { value: 'ing', label: 'Ing' },
  { value: 'nz', label: 'New Zealand' },
];

const VISIT_OPTIONS = [
  { value: 100, label: 'Quick · 100' },
  { value: 500, label: 'Standard · 500' },
  { value: 1_000, label: 'Deep · 1,000' },
];

const BOARD_OPTIONS = [9, 13, 19];

export default function AnalysisSettingsPanel({
  settings,
  hasGame,
  onChange,
  onCreateBoard,
}: AnalysisSettingsPanelProps) {
  const update = <K extends keyof AnalysisSettings>(key: K, value: AnalysisSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <h2 className="text-sm font-semibold text-gray-200 mb-2">Analysis settings</h2>
      <div className="space-y-2 text-xs">
        <label className="flex items-center justify-between gap-3 text-gray-400">
          <span>Visits</span>
          <select
            value={settings.maxVisits}
            onChange={(event) => update('maxVisits', Number(event.target.value))}
            className="min-w-0 flex-1 rounded bg-gray-900 border border-gray-600 px-2 py-1 text-gray-200"
          >
            {VISIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 text-gray-400">
          <span>Rules</span>
          <select
            value={settings.rules}
            onChange={(event) => update('rules', event.target.value as AnalysisRules)}
            className="min-w-0 flex-1 rounded bg-gray-900 border border-gray-600 px-2 py-1 text-gray-200"
          >
            {RULE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 text-gray-400">
          <span>Komi</span>
          <input
            type="number"
            min="-150"
            max="150"
            step="0.5"
            value={settings.komi}
            onChange={(event) => update('komi', Number(event.target.value))}
            className="w-24 rounded bg-gray-900 border border-gray-600 px-2 py-1 text-right text-gray-200"
          />
        </label>

        <label className="flex items-center justify-between gap-3 text-gray-400">
          <span>Board size</span>
          <select
            value={settings.boardSize}
            disabled={hasGame}
            onChange={(event) => update('boardSize', Number(event.target.value))}
            className="min-w-0 flex-1 rounded bg-gray-900 border border-gray-600 px-2 py-1 text-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {BOARD_OPTIONS.map((size) => <option key={size} value={size}>{size} × {size}</option>)}
          </select>
        </label>

        {hasGame ? (
          <p className="text-[11px] text-gray-500">
            Board size follows the loaded SGF ({settings.boardSize} × {settings.boardSize} is only used for new boards).
          </p>
        ) : (
          <button
            type="button"
            onClick={onCreateBoard}
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-gray-200 hover:bg-gray-600"
          >
            Start new {settings.boardSize} × {settings.boardSize} board
          </button>
        )}
      </div>
    </section>
  );
}
