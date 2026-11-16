import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12151a",
        steel: "#5b6673",
        shop: "#d64818",
      },
    },
  },
  plugins: [],
} satisfies Config;
