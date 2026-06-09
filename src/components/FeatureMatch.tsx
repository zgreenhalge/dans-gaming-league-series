export function FeatureMatchIcon () {
  return (
    <span className="relative group">
      <span>
        ⭐
      </span>
      <span 
        className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-max px-2 py-1 text-sm
                   text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] rounded shadow-lg
                   opacity-0 group-hover:opacity-100"
      >
        Featured Match
      </span>
    </span>
  );
}


export function FeatureMatchBanner () {
  return (
    <div className="bg-[var(--color-site-accent)] text-white px-4 py-2 rounded font-semibold text-center mb-6">
      MATCH OF THE WEEK
    </div>
  )
}