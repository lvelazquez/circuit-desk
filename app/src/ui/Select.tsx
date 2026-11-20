// A labelled select with numeric values: the one dropdown every view uses.
export interface Option { value: number; label: string }

export function Select({ label, value, options, onChange, tip, hideLabel, id }: {
  label: string;
  value: number;
  options: readonly Option[];
  onChange: (value: number) => void;
  tip: string;
  hideLabel?: boolean;
  id?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <label>
      {hideLabel ? <span className="visually-hidden">{label}</span> : label}
      <select id={id} value={value} data-tip={tip} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {!known && <option value={value}>{value} (stored, out of range)</option>}
      </select>
    </label>
  );
}

/** Options 0…n−1 labelled by `labels` (enum fields). */
export const optionsOf = (labels: readonly string[]): Option[] => labels.map((label, value) => ({ value, label }));
