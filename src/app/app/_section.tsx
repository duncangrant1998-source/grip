export function SectionPlaceholder({
  title,
  blurb,
  phase,
}: {
  title: string;
  blurb: string;
  phase: string;
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-steel">{blurb}</p>
      <p className="inline-block rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-steel">
        Arrives in {phase}
      </p>
    </div>
  );
}
