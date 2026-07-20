import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Defined as CSS variables (RGB triples) rather than static hex so
        // the same utility classes (bg-surface, text-ink, bg-accent, ...)
        // resolve differently under the `.dark` class — see globals.css for
        // the light/dark variable values. The rgb(var(...) / <alpha-value>)
        // form is required for opacity modifiers like bg-accent/15 to work.
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          faint: "rgb(var(--ink-faint) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          tint: "rgb(var(--surface-tint) / <alpha-value>)",
          line: "rgb(var(--surface-line) / <alpha-value>)",
        },
        accent: { DEFAULT: "rgb(var(--accent) / <alpha-value>)" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
