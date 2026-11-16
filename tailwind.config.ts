import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12151a",
        steel: "#5b6673",
        shop: "#d64818",
        navy: "#1b2a41",
        blueline: "#c7d2e0",
      },
      fontFamily: {
        landing: ['"Work Sans"', "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
