import type { Config } from "tailwindcss";

export default {
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
        ink: {
          DEFAULT: "#1d1d1f",
          soft: "#3a3a3c",
          muted: "#6e6e73",
          faint: "#a1a1a6",
        },
        surface: {
          DEFAULT: "#ffffff",
          tint: "#f5f5f7",
          line: "#e5e5ea",
        },
        accent: { DEFAULT: "#0071e3" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
