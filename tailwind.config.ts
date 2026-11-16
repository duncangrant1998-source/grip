import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12151a",
        asphalt: "#1c2127",
        steel: "#5b6673",
        shop: "#d64818",
        caution: "#f2b705",
        paper: "#f7f5f0",
      },
      fontFamily: {
        display: ["Oswald", "sans-serif"],
        body: ['"Work Sans"', "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
