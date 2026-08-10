/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        paper: '#FBF8F2',
        ink: '#1C1B1A',
        'ink-soft': '#5B564E',
        rule: '#E7E1D4',
        accent: '#3450A3',
        'accent-soft': '#EEF0FA',
        marker: {
          yellow: '#FFD84D',
          green: '#8FD14F',
          blue: '#6EC6FF',
          pink: '#FF8FB3',
          orange: '#FFA94D',
          purple: '#C08FFF',
        },
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        lg: '14px',
      },
      boxShadow: {
        toolbar: '0 8px 24px -6px rgba(28, 27, 26, 0.28)',
        card: '0 1px 2px rgba(28, 27, 26, 0.06), 0 1px 1px rgba(28, 27, 26, 0.04)',
      },
    },
  },
  plugins: [],
};
