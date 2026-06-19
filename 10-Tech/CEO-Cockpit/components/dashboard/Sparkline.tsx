"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "currentColor",
  label,
}: SparklineProps) {
  if (!data.length) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const first = data[0];
  const last = data[data.length - 1];
  const trend = last > first ? "increasing" : last < first ? "decreasing" : "stable";
  const ariaLabel =
    label || `Trend: ${trend} from ${first} to ${last}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="inline-block"
    >
      <title>{ariaLabel}</title>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
      />
      {data.map((v, i) => {
        const x =
          padding + (i / (data.length - 1 || 1)) * (width - 2 * padding);
        const y =
          height - padding - ((v - min) / range) * (height - 2 * padding);
        return (
          <circle key={i} cx={x} cy={y} r={2} fill={color} opacity={0}>
            <title>{v}</title>
          </circle>
        );
      })}
      {/* Hover-visible dots */}
      <style>{`
        svg:hover circle { opacity: 1; }
      `}</style>
    </svg>
  );
}
