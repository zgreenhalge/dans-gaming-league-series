type Size = 'sm' | 'md' | 'lg';

const sizeClasses: Record<Size, { wrapper: string; text: string }> = {
  sm: { wrapper: 'w-7 h-7 text-[11px]', text: 'text-[11px]' },
  md: { wrapper: 'w-10 h-10 text-[13px]', text: 'text-[13px]' },
  lg: { wrapper: 'w-16 h-16 text-[22px]', text: 'text-[22px]' },
};

export default function PlayerAvatar({
  name,
  imageUrl,
  size = 'md',
  round = false,
}: {
  name: string;
  imageUrl?: string | null;
  size?: Size;
  round?: boolean;
}) {
  const { wrapper, text } = sizeClasses[size];

  const placeholderStyle = {
    background: 'color-mix(in srgb, var(--color-site-accent) 14%, var(--color-bg-secondary))',
    borderColor: 'color-mix(in srgb, var(--color-site-accent) 40%, var(--color-border-primary))',
  };

  return (
    <div
      className={`${wrapper} ${round ? 'rounded-full' : 'rounded-sm'} border-2 flex items-center justify-center overflow-hidden shrink-0`}
      style={imageUrl
        ? { borderColor: 'var(--color-border-secondary)' }
        : placeholderStyle}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={`${name}'s avatar`} className="w-full h-full object-cover" />
      ) : (
        <span className={`${text} font-bold select-none`} style={{ color: 'var(--color-site-accent)' }}>
          {name[0].toUpperCase()}
        </span>
      )}
    </div>
  );
}
