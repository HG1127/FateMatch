import animate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        gold: 'hsl(var(--gold))',
        'gold-soft': 'hsl(var(--gold-soft))',
        'red-deep': 'hsl(var(--red-deep))',
        'red-ink': 'hsl(var(--red-ink))',
        ink: 'hsl(var(--ink))',
        paper: 'hsl(var(--paper))'
      },
      fontFamily: {
        xing: ['"Ma Shan Zheng"', '"Xingkai SC"', 'STXingkai', 'KaiTi', 'STKaiti', 'cursive'],
        song: ['"Noto Serif SC"', '"Songti SC"', 'STSong', 'SimSun', 'serif']
      },
      boxShadow: {
        card: '0 2px 6px hsl(20 40% 20% / 0.06), 0 12px 32px -12px hsl(352 60% 30% / 0.18)',
        lift: '0 4px 10px hsl(20 40% 20% / 0.08), 0 24px 48px -16px hsl(352 60% 30% / 0.28)'
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'flip-in': {
          from: { opacity: '0', transform: 'perspective(900px) rotateY(70deg)' },
          to: { opacity: '1', transform: 'perspective(900px) rotateY(0deg)' }
        },
        'pop': {
          '0%': { opacity: '0', transform: 'scale(.7)' },
          '60%': { transform: 'scale(1.06)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        'float-slow': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        'seal-stamp': {
          '0%': { opacity: '0', transform: 'scale(1.8) rotate(-14deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-6deg)' }
        },
        'fade-in': {
          from: { opacity: '0', transform: 'scale(1.02)' },
          to: { opacity: '1', transform: 'scale(1)' }
        }
      },
      animation: {
        'fade-up': 'fade-up .6s ease-out both',
        'flip-in': 'flip-in .5s ease-out both',
        'pop': 'pop .45s cubic-bezier(.2,.9,.3,1.2) both',
        'float-slow': 'float-slow 6s ease-in-out infinite',
        'seal-stamp': 'seal-stamp .5s ease-out both',
        'fade-in': 'fade-in .45s ease-out both'
      }
    }
  },
  plugins: [animate],
}
