'use client';

import { useState } from 'react';

interface Props {
  frontUrl: string;
  backUrl: string;
}

export default function ScreenshotViewer({ frontUrl, backUrl }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex items-center gap-1.5"
      >
        <span>{open ? '▲' : '▼'}</span>
        Score verification screenshots
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[{ label: 'Front', url: frontUrl }, { label: 'Back', url: backUrl }].map(
            ({ label, url }) => (
              <div key={label} className="border border-[var(--color-border-primary)]">
                <div className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)] px-3 py-1.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)]">
                  {label}
                </div>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${label} scoreboard screenshot`}
                    className="w-full object-contain max-h-64 hover:max-h-none transition-all"
                  />
                </a>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
