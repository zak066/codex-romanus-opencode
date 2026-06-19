import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        roman: {
          gold: 'var(--color-roman-gold)',
          'gold-dark': 'var(--color-roman-gold-dark)',
          'gold-light': 'var(--color-roman-gold-light)',
          'gold-glow': 'var(--color-roman-gold-glow)',
        },
        surface: {
          base: 'var(--color-surface-base)',
          raised: 'var(--color-surface-raised)',
          overlay: 'var(--color-surface-overlay)',
          panel: 'var(--color-surface-panel)',
          floating: 'var(--color-surface-floating)',
          deep: 'var(--color-surface-deep)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          dim: 'var(--color-text-dim)',
          inverse: 'var(--color-text-inverse)',
        },
        border: {
          subtle: 'var(--color-border-subtle)',
          default: 'var(--color-border-default)',
          focus: 'var(--color-border-focus)',
          gold: 'var(--color-roman-gold-glow)',
        },
        pompeii: {
          blue: 'var(--color-pompeii-blue)',
          'blue-light': 'var(--color-pompeii-blue-light)',
          green: 'var(--color-pompeii-green)',
          'green-light': 'var(--color-pompeii-green-light)',
        },
      },
      fontFamily: {
        roman: ['serif'],
      },
      animation: {
        'panel-reveal': 'panelReveal 0.5s ease both',
        'slide-up': 'slideUp 0.5s ease both',
        'fade-in': 'fadeIn 0.4s ease both',
        'gold-pulse': 'goldPulse 3s ease-in-out infinite',
      },
      keyframes: {
        panelReveal: {
          '0%': { opacity: '0', clipPath: 'inset(0 0 100% 0)' },
          '100%': { opacity: '1', clipPath: 'inset(0 0 0 0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        goldPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
