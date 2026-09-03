// Shared small mono uppercase label for a subsection within a bordered panel or list.

export default function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
      {children}
    </div>
  );
}
