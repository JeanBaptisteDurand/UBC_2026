/** Tailwind compilé au build (plus de CDN au runtime). Les jetons de couleur et de typo d'ArcHive. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#070b16", panel: "#0f1626", raised: "#141d31", edge: "#1e293b",
        accent: "#5b8cff", good: "#34d399", warn: "#fbbf24", bad: "#f87171", muted: "#8aa0c6", text: "#e6edf7",
      },
      fontFamily: {
        sans: ["Chivo", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'Chivo Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
