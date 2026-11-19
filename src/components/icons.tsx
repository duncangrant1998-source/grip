/**
 * Small inline stroke icon set for the marketing site. Kept as plain SVG
 * (no icon-library dependency) so the bundle stays light. Each icon takes
 * the same props as a normal SVG — pass className to size/color it.
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18" />
      <path d="M8 2.5v4M16 2.5v4" />
      <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </svg>
  );
}

export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.5" y="4" width="13" height="17" rx="2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
      <path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h3" />
    </svg>
  );
}

export function PartsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </svg>
  );
}

export function VehicleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 16V11.5l1.8-4.6A2 2 0 0 1 7.65 5.5h8.7a2 2 0 0 1 1.85 1.4L20 11.5V16" />
      <path d="M4 16h16" />
      <path d="M4 16v2.5a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1V16" />
      <path d="M16.8 16v2.5a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1V16" />
      <circle cx="8" cy="13" r="0.1" />
      <circle cx="16" cy="13" r="0.1" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c.6-3.3 2.9-5.2 5.5-5.2s4.9 1.9 5.5 5.2" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.3 14.6c2 .2 3.6 1.9 4.2 4.9" />
    </svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function TagIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M11.5 3.5H6A2.5 2.5 0 0 0 3.5 6v5.5a2 2 0 0 0 .6 1.4l9 9a2 2 0 0 0 2.8 0l5.6-5.6a2 2 0 0 0 0-2.8l-9-9a2 2 0 0 0-1-.5Z" />
      <circle cx="8" cy="8" r="1.3" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.2 19 6v5.5c0 4.7-3 8.2-7 9.3-4-1.1-7-4.6-7-9.3V6l7-2.8Z" />
      <path d="M9 12l2 2 4-4.2" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.3 12.3l2.4 2.4 5-5.2" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12h15" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function WrenchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 4.9L3 17.5 6.5 21l6.3-6.3a4 4 0 0 0 4.9-5.4l-2.8 2.8-2.1-.7-.7-2.1 2.6-2Z" />
    </svg>
  );
}
