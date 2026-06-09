const SIZES = {
  xs: { px: 24, r: 9, sw: 3, text: 'text-[7px]' },
  sm: { px: 30, r: 11, sw: 4, text: 'text-[9px]' },
  md: { px: 44, r: 17, sw: 5, text: 'text-[13px]' },
  lg: { px: 64, r: 26, sw: 6, text: 'text-[20px]' },
} as const;

export default function RatingCircle({
  value,
  colorStart,
  colorEnd,
  size = 'lg',
}: {
  value: number;
  colorStart: string;
  colorEnd: string;
  size?: keyof typeof SIZES;
}) {
  const { px, r, sw, text } = SIZES[size];
  const c = 2 * Math.PI * r;
  const stroke = `color-mix(in srgb, ${colorEnd} ${value}%, ${colorStart})`;
  return (
    <div className="relative shrink-0" style={{ width: px, height: px }}>
      <svg width={px} height={px}>
        <circle cx={px / 2} cy={px / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={sw} fill="none" />
        <circle
          cx={px / 2} cy={px / 2} r={r}
          stroke={stroke}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform={`rotate(-90 ${px / 2} ${px / 2})`}
        />
      </svg>
      <span className={`display-numeral absolute inset-0 flex items-center justify-center ${text} text-white`}>{value}</span>
    </div>
  );
}
