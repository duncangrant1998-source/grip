# public/

Files served at the site root.

- **grip-logo.png** — the Grip wordmark, shown in the app header and on the
  sign-in page. Converted from the supplied artwork to a transparent PNG: the
  ink is black and the tone is carried in the alpha channel, so the letters are
  knocked out and the mark sits on any background rather than in a white box.
  `src/components/Logo.tsx` falls back to the word GRIP set in type if this
  file is ever missing, so a broken image is never shown.

The browser-tab icon is `src/app/icon.png`, which Next.js picks up by
convention. It is the same mark on a white rounded tile.
