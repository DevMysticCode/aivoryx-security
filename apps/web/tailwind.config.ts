import type { Config } from 'tailwindcss';

// Every color is a CSS custom property (set in src/styles/tokens.css and,
// for tenant primary/secondary/accent, overridden at runtime from validated
// org branding — see src/theme/applyBrandColors.ts). Components must always
// reach for these semantic names (bg-primary, text-muted-foreground, ...),
// never a literal hex value, so a tenant's brand and light/dark mode both
// flow through in one place.
function withOpacity(variable: string) {
  return `rgb(var(${variable}) / <alpha-value>)`;
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: withOpacity('--color-primary'),
          foreground: withOpacity('--color-primary-foreground'),
        },
        secondary: {
          DEFAULT: withOpacity('--color-secondary'),
          foreground: withOpacity('--color-secondary-foreground'),
        },
        accent: {
          DEFAULT: withOpacity('--color-accent'),
          foreground: withOpacity('--color-accent-foreground'),
        },
        background: withOpacity('--color-background'),
        foreground: withOpacity('--color-foreground'),
        muted: {
          DEFAULT: withOpacity('--color-muted'),
          foreground: withOpacity('--color-muted-foreground'),
        },
        border: withOpacity('--color-border'),
        card: {
          DEFAULT: withOpacity('--color-card'),
          foreground: withOpacity('--color-card-foreground'),
        },
        destructive: {
          DEFAULT: withOpacity('--color-destructive'),
          foreground: withOpacity('--color-destructive-foreground'),
        },
        success: {
          DEFAULT: withOpacity('--color-success'),
          foreground: withOpacity('--color-success-foreground'),
        },
        warning: {
          DEFAULT: withOpacity('--color-warning'),
          foreground: withOpacity('--color-warning-foreground'),
        },
        info: {
          DEFAULT: withOpacity('--color-info'),
          foreground: withOpacity('--color-info-foreground'),
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
