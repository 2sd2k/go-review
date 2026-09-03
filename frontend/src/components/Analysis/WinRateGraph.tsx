import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  type DotItemDotProps, type MouseHandlerDataParam,
} from 'recharts';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';
import { QUALITY_COLORS } from '../../lib/moveClassifier';
import type { MoveQuality } from '../../types/analysis';

export default function WinRateGraph() {
  const { results } = useAnalysisStore();
  const { currentMoveIndex, goToMove } = useGameStore();

  const data = useMemo(() => {
    if (results.size === 0) return [];

    const maxMove = Math.max(...results.keys());
    const points = [];

    for (let i = 0; i <= maxMove; i++) {
      const analysis = results.get(i);
      if (analysis) {
        points.push({
          move: i,
          winRate: Math.round(analysis.win_rate * 1000) / 10, // percentage with 1 decimal
          score: Math.round(analysis.score_lead * 10) / 10,
          quality: analysis.quality,
          pointLoss: analysis.point_loss,
        });
      }
    }
    return points;
  }, [results]);

  if (data.length === 0) return null;

  const handleClick = (data: MouseHandlerDataParam) => {
    if (typeof data.activeLabel === 'number') goToMove(data.activeLabel);
  };

  return (
    <div className="w-full">
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Win Rate</h2>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} onClick={handleClick} style={{ cursor: 'pointer' }}>
          <XAxis
            dataKey="move"
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickLine={false}
            axisLine={{ stroke: '#374151' }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickLine={false}
            axisLine={{ stroke: '#374151' }}
            ticks={[0, 25, 50, 75, 100]}
            width={25}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              const quality = d.quality as MoveQuality | undefined;
              return (
                <div className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs">
                  <div className="text-gray-300">Move {d.move}</div>
                  <div className="text-white">Black: {d.winRate}%</div>
                  <div className="text-gray-400">Score: {d.score > 0 ? '+' : ''}{d.score}</div>
                  {quality && (
                    <div style={{ color: QUALITY_COLORS[quality] }}>
                      {quality.charAt(0).toUpperCase() + quality.slice(1)}
                    </div>
                  )}
                  {typeof d.pointLoss === 'number' && d.move > 0 && (
                    <div className="text-gray-400">Point loss: {d.pointLoss.toFixed(1)}</div>
                  )}
                </div>
              );
            }}
          />
          <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="3 3" />
          {/* Current move indicator */}
          <ReferenceLine x={currentMoveIndex} stroke="#f59e0b" strokeWidth={2} />
          <Line
            type="monotone"
            dataKey="winRate"
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={(props: DotItemDotProps) => {
              const { cx, cy, payload } = props;
              if (cx === undefined || cy === undefined) return null;
              const q = (payload as { quality?: MoveQuality }).quality;
              if (!q || q === 'best' || q === 'good') return <g key={`${cx}-${cy}`} />;
              return (
                <circle
                  key={`${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={QUALITY_COLORS[q]}
                  stroke="none"
                />
              );
            }}
            activeDot={{ r: 4, fill: '#f59e0b' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
