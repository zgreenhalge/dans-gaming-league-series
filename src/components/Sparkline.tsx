interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  showDot?: boolean;
}

/** Auto-scaled SVG line chart for short numeric series (e.g. recent ADR). */
export default function Sparkline({
  data,
  width = 120,
  height = 34,
  color = 'currentColor',
  fill,
  strokeWidth = 2,
  showDot = false,
}: SparklineProps) {
  if (data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const span = Math.max(1, data.length - 1);
  const points = data.map((v, i) => [
    (i / span) * (width - strokeWidth) + strokeWidth / 2,
    height - strokeWidth / 2 - ((v - min) / range) * (height - strokeWidth),
  ]);
  const linePath = points
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  const areaPath = fill
    ? `${linePath} L ${last[0].toFixed(1)} ${height} L ${points[0][0].toFixed(1)} ${height} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {areaPath && <path d={areaPath} fill={fill} opacity={0.5} />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && <circle cx={last[0]} cy={last[1]} r={strokeWidth + 1.2} fill={color} />}
    </svg>
  );
}
