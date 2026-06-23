export default function DevGate({ children, className }: { children: React.ReactNode; className?: string }) {
  if (process.env.NODE_ENV !== 'development') return null;
  return <div className={`dev-gate${className ? ` ${className}` : ''}`}>{children}</div>;
}
