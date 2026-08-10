/**
 * Design direction: a calm, professional internal-tools palette — slate/ink
 * base with a single amber accent reserved for "awaiting human decision"
 * states, since that's the moment the whole demo hinges on making legible.
 * Deliberately not the cream+terracotta or near-black+neon defaults.
 */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#161a20",
        slate: {
          950: "#0d1117",
          900: "#161a20",
          800: "#1f242d",
          700: "#2c333e",
          600: "#454e5c",
          500: "#6b7480",
          300: "#c3c9d1",
          100: "#eef0f2",
          50: "#f7f8f9",
        },
        amber: {
          600: "#b6741e",
          500: "#d99a3a",
          100: "#faf1e0",
        },
        teal: {
          600: "#0f6e56",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
