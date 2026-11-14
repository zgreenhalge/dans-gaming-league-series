// The small section label: the `.tracked` broadcast label at 10px in secondary text, naming a
// section of a page, panel or form. Spacing comes from `className` (e.g. `mb-3`); `as="span"`
// keeps it inline where a block element doesn't belong (a heading row's flex child, a button). `id`
// lets a `role="group"` wrapper name itself from the label with `aria-labelledby`.

/** The section-label look, shared with `FieldLabel` so a form's section and field labels match. */
export const SECTION_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

export default function SectionLabel({
  children,
  className,
  as: Tag = 'div',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'span';
  /** For a group's `aria-labelledby` to point at this label. */
  id?: string;
}) {
  return (
    <Tag id={id} className={className ? `${SECTION_LABEL_CLS} ${className}` : SECTION_LABEL_CLS}>
      {children}
    </Tag>
  );
}
