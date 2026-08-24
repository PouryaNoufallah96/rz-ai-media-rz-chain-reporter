export function FunnelBlock({
  lines,
  title,
}: {
  lines: readonly { label: string; value: string }[];
  title: string;
}) {
  return (
    <section className="border border-border p-4">
      <h2 className="ticket-label border-b border-dashed pb-2">{title}</h2>
      <dl className="mt-2 grid gap-1 text-xs">
        {lines.map((line) => (
          <div
            className="flex flex-wrap items-baseline gap-2 border-border border-b border-dashed pb-1"
            key={line.label}
          >
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="ms-auto font-mono tabular-nums">{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
