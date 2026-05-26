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
}: {
  name: string;
  imageUrl?: string | null;
  size?: Size;
}) {
  const { wrapper, text } = sizeClasses[size];

  return (
    <div
      className={`${wrapper} rounded-full border-2 border-gray-400 flex items-center justify-center bg-gray-700 overflow-hidden shrink-0`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={`${name}'s avatar`} className="w-full h-full object-cover" />
      ) : (
        <span className={`${text} font-bold text-gray-300 select-none`}>
          {name[0].toUpperCase()}
        </span>
      )}
    </div>
  );
}
