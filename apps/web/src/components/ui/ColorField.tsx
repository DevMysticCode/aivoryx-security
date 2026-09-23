const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const isValid = value === '' || HEX_PATTERN.test(value);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isValid && value ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-10 cursor-pointer rounded-md border border-border bg-card p-1"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={value}
          placeholder="#00A19A"
          onChange={(event) => onChange(event.target.value)}
          className="h-10 flex-1 rounded-md border border-border bg-card px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      {!isValid && (
        <p className="text-xs text-destructive">Must be a 6-digit hex color, e.g. #00A19A</p>
      )}
    </div>
  );
}
