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
          bg:           '#0a0b14',    // near-black with blue tint
          surface:      '#111425',    // clearly lifted from bg
          surface2:     '#181c32',    // visible step up from surface
          border:       '#2e3558',    // brighter border — good separation
          accent:       '#5fd4ff',    // bright cyan-blue (high pop)
          'accent-hover':'#45b8e6',   // hover state
          accent2:      '#5eeadf',    // bright teal
          green:        '#5eeadf',    // teal from logo, brightened
          blue:         '#0096e8',    // vivid iris blue
          purple:       '#b49dff',    // slightly brighter purple
          amber:        '#ff9e66',    // warm orange from logo
          muted:        '#7585ad',    // more readable muted text
          muted2:       '#3d4568',    // subdued but visible
          text:         '#edf0f7',    // bright clean white
          // dark tinted badge backgrounds
          'tint-green': '#0a2625',
          'tint-blue':  '#0a1528',
          'tint-purple':'#181230',
          'tint-red':   '#280e14',
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
