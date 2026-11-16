import fs from "node:fs";
import path from "node:path";

/**
 * The Grip wordmark.
 *
 * Uses the image at `public/grip-logo.png` when it is there and falls back to
 * type when it isn't, so a missing file is a plain wordmark rather than a
 * broken image icon. The check is a stat per render — cheap, and it means
 * dropping the file in takes effect without a restart.
 */
const LOGO_PATH = "grip-logo.png";

export function Logo({ className = "h-6" }: { className?: string }) {
  const present = fs.existsSync(path.join(process.cwd(), "public", LOGO_PATH));

  if (!present) {
    return <span className="text-sm font-bold tracking-widest text-shop">GRIP</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/${LOGO_PATH}`} alt="Grip" className={`w-auto max-w-full object-contain ${className}`} />
  );
}
