/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: "#050710",
        plasma: "#ff3d9a",
        volt: "#33f7ff",
        aurora: "#8b5cf6",
        ember: "#ffb86b",
      },
      boxShadow: {
        glow: "0 0 44px rgba(51, 247, 255, 0.22)",
        magenta: "0 0 42px rgba(255, 61, 154, 0.32)",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(circle at 18% 12%, rgba(51,247,255,.18), transparent 28%), radial-gradient(circle at 78% 4%, rgba(255,61,154,.22), transparent 30%), radial-gradient(circle at 72% 78%, rgba(255,184,107,.14), transparent 24%)",
      },
    },
  },
  plugins: [],
};
