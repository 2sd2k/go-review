import type { EditTool } from '../../types/game';
import { useGameStore } from '../../stores/gameStore';

const TOOLS: { id: EditTool; label: string; title: string }[] = [
  { id: 'play', label: '●', title: 'Place stones' },
  { id: 'triangle', label: '△', title: 'Triangle (Esc to return to stones)' },
  { id: 'circle', label: '○', title: 'Circle' },
  { id: 'square', label: '□', title: 'Square' },
];

export default function MarkupToolbar() {
  const { editTool, setEditTool } = useGameStore();

  return (
    <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
      <h2 className="text-sm font-semibold text-gray-200 mb-2">Markup</h2>
      <div className="flex gap-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            title={tool.title}
            onClick={() => setEditTool(tool.id)}
            className={`flex-1 px-2 py-1.5 text-base rounded transition-colors ${
              editTool === tool.id
                ? 'bg-amber-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {tool.label}
          </button>
        ))}
      </div>
      {editTool !== 'play' && (
        <p className="text-[10px] text-gray-500 mt-1.5">
          Click the board to toggle a mark. Click again to remove it.
        </p>
      )}
    </div>
  );
}
