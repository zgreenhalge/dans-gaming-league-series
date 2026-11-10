import { SECTION_LABEL_CLS } from './SectionLabel';

// A form field's label: a real `<label htmlFor>` tied to its input by id, in the `SectionLabel`
// look. It renders as a block above its input; spacing comes from `className` (e.g. `mb-2`).

export default function FieldLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  const cls = `block ${SECTION_LABEL_CLS}`;
  return (
    <label htmlFor={htmlFor} className={className ? `${cls} ${className}` : cls}>
      {children}
    </label>
  );
}
