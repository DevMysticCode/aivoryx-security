const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * What the swatch shows/opens to when no value is set yet. Defaults to the
   * Aivoryx brand teal — never pure black, since a native color `<input>`
   * can't represent "unset" and always needs a real value: opening the
   * picker and dismissing it without changing anything fires `onChange`
   * with whatever the swatch was showing, so defaulting to black made it
   * easy to silently commit black as the brand color by just clicking in
   * and back out.
   */
  defaultSwatch?: string;
}

export function ColorField({ label, value, onChange, defaultSwatch = '#00A19A' }: ColorFieldProps) {
  const isValid = value === '' || HEX_PATTERN.test(value);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isValid && value ? value : defaultSwatch}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-10 cursor-pointer rounded-md border border-border bg-card p-1"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={value}
          placeholder={defaultSwatch}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 flex-1 rounded-md border border-border bg-card px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {!isValid && (
        <p className="text-xs text-destructive">Must be a 6-digit hex color, e.g. #00A19A</p>
      )}
    </div>
  );
}
