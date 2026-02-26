/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,css,html}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Mono"', 'monospace'],
        body: ['"Instrument Sans"', 'sans-serif'],
      },
      colors: {
        snap: {
          bg:      '#0e0f14',
          surface: '#16181f',
          surface2:'#1e2028',
          border:  '#2a2d38',
          accent:  '#ff6b35',
          accent2: '#ffd166',
          green:   '#3ecf8e',
          blue:    '#4d9fff',
          purple:  '#a78bfa',
          muted:   '#6b7280',
          muted2:  '#3a3f52',
          text:    '#e8eaf0',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease forwards',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:  { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseDot: { '0%,100%': { transform: 'scale(1)', opacity: 1 }, '50%': { transform: 'scale(1.4)', opacity: 0.6 } },
      }
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
