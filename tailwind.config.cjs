/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  // A glossary-separator regex was once mistaken for this arbitrary-property
  // utility and produced invalid CSS. It can never be a legitimate class, so
  // keep the scanner from materializing it if equivalent source text returns.
  blocklist: ['[-:\\s]'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Inter', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        'display-sm': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.01em' }],
        'display-md': ['2.25rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em' }],
        'display-lg': ['3rem', { lineHeight: '3.5rem', letterSpacing: '-0.02em' }],
      },
      letterSpacing: {
        'wider-2': '0.18em',
        'widest-2': '0.28em',
      },
      colors: {
        gray: {
          50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8',
          400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46',
          800: '#27272a', 900: '#18181b', 950: '#09090b',
        },
        primary: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
        ai: {
          50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc',
          400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf',
          800: '#86198f', 900: '#701a75', 950: '#4a044e',
        },
        'audience-exec': '#0ea5e9',
        'audience-tech': '#6366f1',
        'audience-ops': '#f59e0b',
        success: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 900: '#14532d' },
        warning: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 900: '#78350f' },
        danger: { 50: '#fef2f2', 100: '#fee2e2', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 900: '#7f1d1d' },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
        'glow-primary': '0 0 0 1px rgba(99,102,241,0.4), 0 8px 32px -8px rgba(99,102,241,0.45)',
        'glow-ai': '0 0 0 1px rgba(217,70,239,0.4), 0 8px 32px -8px rgba(217,70,239,0.45)',
        pop: '0 16px 48px -16px rgba(15,23,42,0.4)',
      },
      backgroundImage: {
        'ai-gradient': 'linear-gradient(135deg, #6366f1 0%, #d946ef 50%, #ec4899 100%)',
        'ai-soft': 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(217,70,239,0.10))',
        'mesh-light': 'radial-gradient(at 27% 37%, hsla(215, 98%, 61%, 0.08) 0px, transparent 0%), radial-gradient(at 97% 21%, hsla(280, 98%, 61%, 0.07) 0px, transparent 50%), radial-gradient(at 52% 99%, hsla(354, 98%, 61%, 0.05) 0px, transparent 50%)',
        'mesh-dark': 'radial-gradient(at 27% 37%, hsla(215, 98%, 61%, 0.12) 0px, transparent 50%), radial-gradient(at 97% 21%, hsla(280, 98%, 61%, 0.10) 0px, transparent 50%), radial-gradient(at 52% 99%, hsla(354, 98%, 61%, 0.08) 0px, transparent 50%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-left': 'slideInLeft 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.2s ease-out',
        shimmer: 'shimmer 2s infinite linear',
        'shimmer-slow': 'shimmer 3.2s infinite linear',
        'gradient-shift': 'gradientShift 8s ease infinite',
        'ai-pulse': 'aiPulse 2.4s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'caret-blink': 'caretBlink 1.1s steps(1) infinite',
        'progress-indeterminate': 'progressIndeterminate 1.6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideInRight: { '0%': { transform: 'translateX(16px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        slideInLeft: { '0%': { transform: 'translateX(-16px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        scaleIn: { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        gradientShift: { '0%, 100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
        aiPulse: { '0%, 100%': { transform: 'scale(1)', opacity: '0.85' }, '50%': { transform: 'scale(1.06)', opacity: '1' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        caretBlink: { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0' } },
        progressIndeterminate: {
          '0%': { transform: 'translateX(-100%) scaleX(0.4)' },
          '60%': { transform: 'translateX(40%) scaleX(0.6)' },
          '100%': { transform: 'translateX(180%) scaleX(0.4)' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
