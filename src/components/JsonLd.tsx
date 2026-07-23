import { jsonLdScript } from '@/lib/structured-data';

/** Renders a `<script type="application/ld+json">` tag, or nothing when `data` is `null`. */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
