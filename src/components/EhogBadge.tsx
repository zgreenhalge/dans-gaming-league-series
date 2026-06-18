export const GRADE_TIERS = [
  { min: 99, color: '#f5c542' },  // gold
  { min: 95, color: '#eb4b4b' },  // red
  { min: 80, color: '#d32ee6' },  // pink
  { min: 60, color: '#8847ff' },  // purple
  { min: 30, color: '#4b69ff' },  // blue
  { min: 15, color: '#1ac8ed' },  // cyan
  { min: 0,  color: '#b0b0b0' },  // grey
] as const;

export function ehogColorFor(rating: number) {
  return (GRADE_TIERS.find((t) => rating >= t.min) ?? GRADE_TIERS[GRADE_TIERS.length - 1]).color;
}

export default function EhogBadge({ rating }: { rating: number }) {
  const color = ehogColorFor(rating);
  return (
    <div
      className="relative flex items-center justify-center w-[74px] h-[64px] border-[3px] font-display text-[24px] font-bold"
      style={{
        borderColor: color,
        color,
        background: `linear-gradient(160deg, ${color}18 0%, ${color}08 100%)`,
        boxShadow: `inset 0 0 20px ${color}30, 0 0 8px ${color}20`,
      }}
      title={`EHOG Rating: ${rating.toFixed(2)}`}
    >
      <span className="tracked text-[7px] absolute top-[3px] left-[4px]" style={{ color }}>EHOG</span>
      <span className="inline-flex items-baseline">{Math.floor(rating)}<span className="text-[14px]">.{rating.toFixed(2).split('.')[1]}</span></span>
    </div>
  );
}
