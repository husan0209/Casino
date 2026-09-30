/**
 * Подпись поля вынесена из placeholder: placeholder исчезает при вводе, а у
 * date/select его и вовсе не видно (ТЗ ч.5.1 §4).
 */
export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}
