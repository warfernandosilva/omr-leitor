/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // ─── Identidade Gabarito+ ───
        // Azul principal #1769FF (ações), azul-claro #EAF2FF (fundos/seleção),
        // azul-marinho #0B1F3A (navegação/identidade).
        brand: {
          50: '#EAF2FF',
          100: '#D5E3FF',
          200: '#ADC8FF',
          300: '#7CA6FF',
          400: '#4785FF',
          500: '#1769FF',
          600: '#0F5CE6',
          700: '#0D4CBC',
          800: '#0E3F97',
          900: '#0E367A',
        },
        navy: {
          700: '#1E3A66',
          800: '#14294D',
          900: '#0B1F3A',
          950: '#071527',
        },
        ink: '#172B4D',
        surface: '#F5F7FB',
        line: '#E2E8F0',
        success: {
          50: '#E7F7EF',
          100: '#C9ECDA',
          500: '#16A36A',
          600: '#128557',
          700: '#0E6A46',
        },
        warning: {
          50: '#FEF4E2',
          100: '#FDE6C4',
          500: '#F59E0B',
          600: '#D98706',
          700: '#B45309',
        },
        danger: {
          50: '#FDECEF',
          100: '#FAD5DC',
          500: '#DC3545',
          600: '#C22A3A',
          700: '#A12231',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.1)',
        modal: '0 12px 32px rgba(16,24,40,0.18)',
      },
      borderRadius: {
        xl2: '1rem',
        '2xl2': '1.25rem',
      }
    },
  },
  plugins: [],
}
