import {
  Card,
  CardContent,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";

export function FunnelBlock({
  lines,
  title,
}: {
  lines: readonly { label: string; value: string }[];
  title: string;
}) {
  return (
    <section className="h-full">
      <Card className="h-full gap-3">
        <CardHeader>
          <h2 className="font-semibold text-sm">{title}</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-xs">
            {lines.map((line) => (
              <div
                className="flex flex-wrap items-baseline gap-3 border-border border-b pb-2 last:border-0 last:pb-0"
                key={line.label}
              >
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="ms-auto font-medium tabular-nums">
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
