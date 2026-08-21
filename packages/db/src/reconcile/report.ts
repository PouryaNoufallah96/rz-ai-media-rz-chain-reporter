export type ReconcileMode = "apply" | "check";

export type ReconcileEntity =
  | "workspace"
  | "media_brand"
  | "source"
  | "destination_account"
  | "media_brand_destination_account";

const RECONCILE_OUTCOMES = [
  "added",
  "updated",
  "disabled",
  "retired",
  "restored",
  "unchanged",
  "blocked",
] as const;

export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export type ReconcileEntry = {
  entity: ReconcileEntity;
  key: string;
  outcome: ReconcileOutcome;
  fields?: readonly string[];
};

export type ReconcileReport = {
  mode: ReconcileMode;
  customerTemplateKey: string;
  // Null only for the check report of a database with no workspace row yet.
  workspaceId: string | null;
  fingerprint: string;
  entries: readonly ReconcileEntry[];
  divergent: boolean;
  // Null when the run wrote nothing, so an identical rerun leaves applied state unchanged.
  appliedAt: Date | null;
};

const OUTCOME_WIDTH = 9;
const ENTITY_WIDTH = 31;

export function formatReconcileReport(report: ReconcileReport) {
  const counts = RECONCILE_OUTCOMES.map((outcome) => {
    const total = report.entries.filter(
      (entry) => entry.outcome === outcome,
    ).length;

    return `${outcome} ${total}`;
  });

  const lines = [
    `template:reconcile ${report.customerTemplateKey} (${report.mode})`,
    `fingerprint ${report.fingerprint}`,
    counts.join("  "),
  ];

  for (const entry of report.entries) {
    if (entry.outcome === "unchanged") {
      continue;
    }

    const fields = entry.fields?.length ? ` [${entry.fields.join(", ")}]` : "";

    lines.push(
      `  ${entry.outcome.padEnd(OUTCOME_WIDTH)} ${entry.entity.padEnd(ENTITY_WIDTH)} ${entry.key}${fields}`,
    );
  }

  if (report.mode === "check") {
    lines.push(
      report.divergent
        ? "divergence detected; nothing written"
        : "installation matches the customer template",
    );
  } else {
    lines.push(
      report.appliedAt
        ? `applied state recorded ${report.appliedAt.toISOString()}`
        : "no changes; applied state untouched",
    );
  }

  return lines.join("\n");
}
