/**
 * Design system per design_handoff_approval_flow/README.md (Claude Design
 * handoff, Aug 2026) -- warm paper canvas with a single teal accent, replacing
 * the earlier slate/amber direction. Token names/values match the handoff's
 * "Design tokens" section exactly.
 */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EAE3D7",
        app: "#F8F4ED",
        rail: "#F3EEE4",
        surface: "#FFFDF9",
        card: "#FDFAF4",
        panel: "#FFFFFF",
        hairline: "#EBE3D6",
        "hairline-soft": "#EFE7DA",
        ink: {
          DEFAULT: "#191817",
          2: "#26241F",
          3: "#2A2620",
          muted: "#4A453F",
        },
        text: {
          secondary: "#6B6660",
          tertiary: "#8A847B",
          quaternary: "#A39C93",
        },
        placeholder: "#C6C0B7",
        neutral: {
          fill: "#F2EBDF",
          "fill-2": "#EAE1D2",
        },
        control: "#E4DBCB",
        accent: {
          DEFAULT: "#0E7A68",
          dark: "#0A5C4E",
          tint: "#E9F3F0",
        },
        warning: {
          ink: "#9A5B3C",
          strong: "#8C4A2F",
        },
      },
      fontFamily: {
        // Loaded via a plain <link> in layout.tsx, not next/font/google --
        // see that file for why (a build-time font fetch hung in this
        // environment). Reference the family names directly since there's
        // no next/font CSS variable to point at.
        sans: ["Instrument Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 1px rgba(60,45,25,.045), 0 16px 34px -24px rgba(60,45,25,.6)",
        panel: "0 1px 2px rgba(60,45,25,.05), 0 22px 46px -32px rgba(60,45,25,.7)",
        bubble: "0 1px 1px rgba(60,45,25,.03)",
        "ink-cta": "0 12px 26px -18px rgba(25,24,23,1)",
        "teal-cta": "0 10px 24px -14px rgba(14,122,104,.95)",
        "teal-strip": "0 10px 22px -16px rgba(14,122,104,1)",
      },
      keyframes: {
        msgin: {
          "0%": { transform: "translateY(8px)", opacity: 0 },
          "100%": { transform: "translateY(0)", opacity: 1 },
        },
        cardin: {
          "0%": { transform: "translateY(12px)", opacity: 0 },
          "100%": { transform: "translateY(0)", opacity: 1 },
        },
        fillbar: {
          "0%": { width: "14%" },
          "100%": { width: "74%" },
        },
        breathe: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
      },
      animation: {
        msgin: "msgin 450ms ease",
        cardin: "cardin 600ms cubic-bezier(.22,.9,.3,1) 100ms both",
        fillbar: "fillbar 3.4s cubic-bezier(.4,0,.2,1) infinite alternate",
        breathe: "breathe 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
