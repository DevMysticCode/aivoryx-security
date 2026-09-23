import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, ...props },
  ref,
) {
  return (
    <label htmlFor={id} className={clsx('flex items-start gap-3 text-sm', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        {...props}
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        {description && <span className="block text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
});
