import type { LoadedCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import { eq, sql } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { inWorkspace } from "../filters";
import { destinationAccount } from "../schema/destination-account";
import { mediaBrand } from "../schema/media-brand";
import { mediaBrandDestinationAccount } from "../schema/media-brand-destination-account";
import { source } from "../schema/source";
import { workspace } from "../schema/workspace";
import type {
  ReconcileEntity,
  ReconcileEntry,
  ReconcileMode,
  ReconcileOutcome,
  ReconcileReport,
} from "./report";

const RECONCILE_ERROR_CODES = [
  "MULTIPLE_WORKSPACES",
  "FOREIGN_INSTALLATION",
] as const;

export type ReconcileErrorCode = (typeof RECONCILE_ERROR_CODES)[number];

export class ReconcileError extends Error {
  readonly code: ReconcileErrorCode;

  constructor(code: ReconcileErrorCode, message: string) {
    super(message);
    this.name = "ReconcileError";
    this.code = code;
  }
}

type ReconcileRun = { mode: ReconcileMode; at: Date };

type EntityResult = {
  entries: ReconcileEntry[];
  idByKey: Map<string, string>;
};

const INSTALLATION_LOCK = "customer_template_reconcile";

export async function reconcileCustomerTemplate(
  executor: Executor,
  loaded: LoadedCustomerTemplate,
  mode: ReconcileMode,
): Promise<ReconcileReport> {
  const { template, fingerprint } = loaded;
  const customerTemplateKey = template.customer.key;

  return executor.transaction(
    async (tx) => {
      // Deployment-wide lock: the first run has no workspace row to key on.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${INSTALLATION_LOCK}))`,
      );

      const run: ReconcileRun = { mode, at: new Date() };
      const existing = await findWorkspace(tx, customerTemplateKey);

      if (!existing && mode === "check") {
        return unprovisionedReport(template, fingerprint);
      }

      const workspaceId = existing
        ? existing.id
        : await insertWorkspace(tx, template, fingerprint, run.at);

      const brands = await reconcileMediaBrands(
        tx,
        workspaceId,
        template.mediaBrands,
        run,
      );
      const sources = await reconcileSources(
        tx,
        workspaceId,
        template.sources,
        run,
      );
      const destinations = await reconcileDestinationAccounts(
        tx,
        workspaceId,
        template.destinationAccounts,
        run,
      );
      const mappings = await reconcileBrandDestinations(
        tx,
        workspaceId,
        template.brandDestinations,
        { brands: brands.idByKey, destinations: destinations.idByKey },
        run,
      );

      const entries: ReconcileEntry[] = [
        existing
          ? diffWorkspace(existing, template, fingerprint)
          : entry("workspace", customerTemplateKey, "added"),
        ...brands.entries,
        ...sources.entries,
        ...destinations.entries,
        ...mappings.entries,
      ];

      const divergent = entries.some((row) => row.outcome !== "unchanged");
      const appliedAt = mode === "apply" && divergent ? run.at : null;

      // Stamp applied state in this transaction only when the run wrote something.
      if (existing && appliedAt) {
        await tx
          .update(workspace)
          .set({
            name: template.workspace.name,
            customerTemplateKey,
            customerTemplateFingerprint: fingerprint,
            customerTemplateAppliedAt: appliedAt,
          })
          .where(eq(workspace.id, existing.id));
      }

      return {
        mode,
        customerTemplateKey,
        workspaceId,
        fingerprint,
        entries,
        divergent,
        appliedAt,
      };
    },
    { accessMode: mode === "check" ? "read only" : "read write" },
  );
}

function entry(
  entity: ReconcileEntity,
  key: string,
  outcome: ReconcileOutcome,
  fields?: readonly string[],
): ReconcileEntry {
  return { entity, key, outcome, fields };
}

type WorkspaceRow = {
  id: string;
  name: string;
  customerTemplateKey: string | null;
  customerTemplateFingerprint: string | null;
};

async function findWorkspace(tx: Transaction, customerTemplateKey: string) {
  const rows = await tx
    .select({
      id: workspace.id,
      name: workspace.name,
      customerTemplateKey: workspace.customerTemplateKey,
      customerTemplateFingerprint: workspace.customerTemplateFingerprint,
    })
    .from(workspace);

  if (rows.length > 1) {
    throw new ReconcileError(
      "MULTIPLE_WORKSPACES",
      `database holds ${rows.length} workspace rows; an installation has exactly one`,
    );
  }

  const [existing] = rows;

  // Null key is adopted; a different key belongs to another installation and must not be rewritten.
  if (
    existing?.customerTemplateKey != null &&
    existing.customerTemplateKey !== customerTemplateKey
  ) {
    throw new ReconcileError(
      "FOREIGN_INSTALLATION",
      `database is provisioned for customer template "${existing.customerTemplateKey}", not "${customerTemplateKey}"`,
    );
  }

  return existing;
}

async function insertWorkspace(
  tx: Transaction,
  template: CustomerTemplate,
  fingerprint: string,
  at: Date,
) {
  const [created] = await tx
    .insert(workspace)
    .values({
      name: template.workspace.name,
      customerTemplateKey: template.customer.key,
      customerTemplateFingerprint: fingerprint,
      customerTemplateAppliedAt: at,
    })
    .returning({ id: workspace.id });

  if (!created) {
    throw new Error("workspace insert returned no row");
  }

  return created.id;
}

function diffWorkspace(
  existing: WorkspaceRow,
  template: CustomerTemplate,
  fingerprint: string,
): ReconcileEntry {
  const key = template.customer.key;
  const fields: string[] = [];

  if (existing.name !== template.workspace.name) {
    fields.push("name");
  }

  if (existing.customerTemplateKey !== key) {
    fields.push("customer_template_key");
  }

  if (existing.customerTemplateFingerprint !== fingerprint) {
    fields.push("customer_template_fingerprint");
  }

  return fields.length === 0
    ? entry("workspace", key, "unchanged")
    : entry("workspace", key, "updated", fields);
}

function unprovisionedReport(
  template: CustomerTemplate,
  fingerprint: string,
): ReconcileReport {
  return {
    mode: "check",
    customerTemplateKey: template.customer.key,
    workspaceId: null,
    fingerprint,
    entries: [
      entry("workspace", template.customer.key, "added"),
      ...template.mediaBrands.map((brand) =>
        entry("media_brand", brand.key, "added"),
      ),
      ...template.sources.map((configured) =>
        entry("source", configured.key, "added"),
      ),
      ...template.destinationAccounts.map((account) =>
        entry("destination_account", account.key, "added"),
      ),
      ...template.brandDestinations.map((mapping) =>
        entry(
          "media_brand_destination_account",
          mappingKey(mapping.brandKey, mapping.destinationKey),
          "added",
        ),
      ),
    ],
    divergent: true,
    appliedAt: null,
  };
}

async function reconcileMediaBrands(
  tx: Transaction,
  workspaceId: string,
  brands: CustomerTemplate["mediaBrands"],
  run: ReconcileRun,
): Promise<EntityResult> {
  const existing = await tx
    .select({
      id: mediaBrand.id,
      key: mediaBrand.key,
      name: mediaBrand.name,
      sortOrder: mediaBrand.sortOrder,
      deletedAt: mediaBrand.deletedAt,
    })
    .from(mediaBrand)
    .where(inWorkspace(mediaBrand, workspaceId));

  const byKey = new Map(existing.map((row) => [row.key, row]));
  const entries: ReconcileEntry[] = [];
  const idByKey = new Map<string, string>();

  for (const [index, brand] of brands.entries()) {
    // sort_order is derived from authored template order, not a separate field.
    const sortOrder = index + 1;
    const values = { name: brand.name, sortOrder };
    const current = byKey.get(brand.key);

    if (!current) {
      if (run.mode === "apply") {
        const [created] = await tx
          .insert(mediaBrand)
          .values({ workspaceId, key: brand.key, ...values })
          .returning({ id: mediaBrand.id });

        if (!created) {
          throw new Error("media brand insert returned no row");
        }

        idByKey.set(brand.key, created.id);
      }

      entries.push(entry("media_brand", brand.key, "added"));
      continue;
    }

    idByKey.set(brand.key, current.id);

    const fields: string[] = [];

    if (current.name !== brand.name) {
      fields.push("name");
    }

    if (current.sortOrder !== sortOrder) {
      fields.push("sort_order");
    }

    if (current.deletedAt !== null) {
      if (run.mode === "apply") {
        await tx
          .update(mediaBrand)
          .set({ ...values, deletedAt: null })
          .where(eq(mediaBrand.id, current.id));
      }

      entries.push(entry("media_brand", brand.key, "restored", fields));
      continue;
    }

    if (fields.length === 0) {
      entries.push(entry("media_brand", brand.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(mediaBrand)
        .set(values)
        .where(eq(mediaBrand.id, current.id));
    }

    entries.push(entry("media_brand", brand.key, "updated", fields));
  }

  const templateKeys = new Set(brands.map((brand) => brand.key));

  for (const row of existing) {
    if (templateKeys.has(row.key)) {
      continue;
    }

    if (row.deletedAt !== null) {
      entries.push(entry("media_brand", row.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(mediaBrand)
        .set({ deletedAt: run.at })
        .where(eq(mediaBrand.id, row.id));
    }

    entries.push(entry("media_brand", row.key, "retired"));
  }

  return { entries, idByKey };
}

async function reconcileSources(
  tx: Transaction,
  workspaceId: string,
  sources: CustomerTemplate["sources"],
  run: ReconcileRun,
): Promise<EntityResult> {
  const existing = await tx
    .select({
      id: source.id,
      key: source.key,
      origin: source.origin,
      endpoint: source.endpoint,
      name: source.name,
      enabled: source.enabled,
      metadata: source.metadata,
      deletedAt: source.deletedAt,
    })
    .from(source)
    .where(inWorkspace(source, workspaceId));

  const byKey = new Map(existing.map((row) => [row.key, row]));
  const entries: ReconcileEntry[] = [];
  const idByKey = new Map<string, string>();

  for (const configured of sources) {
    const values = {
      origin: configured.origin,
      endpoint: configured.endpoint,
      name: configured.name,
      enabled: configured.enabled,
      metadata: configured.metadata ?? null,
    };
    const current = byKey.get(configured.key);

    if (!current) {
      if (run.mode === "apply") {
        const [created] = await tx
          .insert(source)
          .values({ workspaceId, key: configured.key, ...values })
          .returning({ id: source.id });

        if (!created) {
          throw new Error("source insert returned no row");
        }

        idByKey.set(configured.key, created.id);
      }

      entries.push(entry("source", configured.key, "added"));
      continue;
    }

    idByKey.set(configured.key, current.id);

    const fields: string[] = [];

    if (current.origin !== configured.origin) {
      fields.push("origin");
    }

    if (current.endpoint !== configured.endpoint) {
      fields.push("endpoint");
    }

    if (current.name !== configured.name) {
      fields.push("name");
    }

    if (current.enabled !== configured.enabled) {
      fields.push("enabled");
    }

    if (
      canonicalMetadata(current.metadata) !== canonicalMetadata(values.metadata)
    ) {
      fields.push("metadata");
    }

    if (current.deletedAt !== null) {
      if (run.mode === "apply") {
        await tx
          .update(source)
          .set({ ...values, deletedAt: null })
          .where(eq(source.id, current.id));
      }

      entries.push(entry("source", configured.key, "restored", fields));
      continue;
    }

    if (fields.length === 0) {
      entries.push(entry("source", configured.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx.update(source).set(values).where(eq(source.id, current.id));
    }

    entries.push(
      entry(
        "source",
        configured.key,
        current.enabled && !configured.enabled ? "disabled" : "updated",
        fields,
      ),
    );
  }

  const templateKeys = new Set(sources.map((configured) => configured.key));

  for (const row of existing) {
    if (templateKeys.has(row.key)) {
      continue;
    }

    if (row.deletedAt !== null) {
      entries.push(entry("source", row.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(source)
        .set({ deletedAt: run.at })
        .where(eq(source.id, row.id));
    }

    entries.push(entry("source", row.key, "retired"));
  }

  return { entries, idByKey };
}

async function reconcileDestinationAccounts(
  tx: Transaction,
  workspaceId: string,
  accounts: CustomerTemplate["destinationAccounts"],
  run: ReconcileRun,
): Promise<EntityResult> {
  const existing = await tx
    .select({
      id: destinationAccount.id,
      key: destinationAccount.key,
      platform: destinationAccount.platform,
      enabled: destinationAccount.enabled,
      metadata: destinationAccount.metadata,
      deletedAt: destinationAccount.deletedAt,
    })
    .from(destinationAccount)
    .where(inWorkspace(destinationAccount, workspaceId));

  const byKey = new Map(existing.map((row) => [row.key, row]));
  const entries: ReconcileEntry[] = [];
  const idByKey = new Map<string, string>();

  for (const account of accounts) {
    // binding_* is the runtime projection and is not written here.
    const values = {
      platform: account.platform,
      enabled: account.enabled,
      metadata: account.metadata,
    };
    const current = byKey.get(account.key);

    if (!current) {
      if (run.mode === "apply") {
        const [created] = await tx
          .insert(destinationAccount)
          .values({ workspaceId, key: account.key, ...values })
          .returning({ id: destinationAccount.id });

        if (!created) {
          throw new Error("destination account insert returned no row");
        }

        idByKey.set(account.key, created.id);
      }

      entries.push(entry("destination_account", account.key, "added"));
      continue;
    }

    idByKey.set(account.key, current.id);

    const fields: string[] = [];

    if (current.platform !== account.platform) {
      fields.push("platform");
    }

    if (current.enabled !== account.enabled) {
      fields.push("enabled");
    }

    if (
      canonicalMetadata(current.metadata) !== canonicalMetadata(values.metadata)
    ) {
      fields.push("metadata");
    }

    if (current.deletedAt !== null) {
      if (run.mode === "apply") {
        await tx
          .update(destinationAccount)
          .set({ ...values, deletedAt: null })
          .where(eq(destinationAccount.id, current.id));
      }

      entries.push(
        entry("destination_account", account.key, "restored", fields),
      );
      continue;
    }

    if (fields.length === 0) {
      entries.push(entry("destination_account", account.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(destinationAccount)
        .set(values)
        .where(eq(destinationAccount.id, current.id));
    }

    entries.push(
      entry(
        "destination_account",
        account.key,
        current.enabled && !account.enabled ? "disabled" : "updated",
        fields,
      ),
    );
  }

  const templateKeys = new Set(accounts.map((account) => account.key));

  for (const row of existing) {
    if (templateKeys.has(row.key)) {
      continue;
    }

    if (row.deletedAt !== null) {
      entries.push(entry("destination_account", row.key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(destinationAccount)
        .set({ deletedAt: run.at })
        .where(eq(destinationAccount.id, row.id));
    }

    entries.push(entry("destination_account", row.key, "retired"));
  }

  return { entries, idByKey };
}

function mappingKey(brandKey: string, destinationKey: string) {
  return `${brandKey} -> ${destinationKey}`;
}

async function reconcileBrandDestinations(
  tx: Transaction,
  workspaceId: string,
  mappings: CustomerTemplate["brandDestinations"],
  ids: { brands: Map<string, string>; destinations: Map<string, string> },
  run: ReconcileRun,
) {
  // Match on joined stable keys so a check can diff mappings whose rows do not exist yet.
  const existing = await tx
    .select({
      id: mediaBrandDestinationAccount.id,
      brandKey: mediaBrand.key,
      destinationKey: destinationAccount.key,
      deletedAt: mediaBrandDestinationAccount.deletedAt,
    })
    .from(mediaBrandDestinationAccount)
    .innerJoin(
      mediaBrand,
      eq(mediaBrand.id, mediaBrandDestinationAccount.mediaBrandId),
    )
    .innerJoin(
      destinationAccount,
      eq(
        destinationAccount.id,
        mediaBrandDestinationAccount.destinationAccountId,
      ),
    )
    .where(inWorkspace(mediaBrandDestinationAccount, workspaceId));

  const byPair = new Map(
    existing.map((row) => [mappingKey(row.brandKey, row.destinationKey), row]),
  );
  const entries: ReconcileEntry[] = [];

  for (const mapping of mappings) {
    const key = mappingKey(mapping.brandKey, mapping.destinationKey);
    const current = byPair.get(key);

    if (!current) {
      if (run.mode === "apply") {
        const mediaBrandId = ids.brands.get(mapping.brandKey);
        const destinationAccountId = ids.destinations.get(
          mapping.destinationKey,
        );

        if (!mediaBrandId || !destinationAccountId) {
          throw new Error(`mapping ${key} references an unreconciled row`);
        }

        await tx
          .insert(mediaBrandDestinationAccount)
          .values({ workspaceId, mediaBrandId, destinationAccountId });
      }

      entries.push(entry("media_brand_destination_account", key, "added"));
      continue;
    }

    if (current.deletedAt !== null) {
      if (run.mode === "apply") {
        await tx
          .update(mediaBrandDestinationAccount)
          .set({ deletedAt: null })
          .where(eq(mediaBrandDestinationAccount.id, current.id));
      }

      entries.push(entry("media_brand_destination_account", key, "restored"));
      continue;
    }

    entries.push(entry("media_brand_destination_account", key, "unchanged"));
  }

  const templatePairs = new Set(
    mappings.map((mapping) =>
      mappingKey(mapping.brandKey, mapping.destinationKey),
    ),
  );

  for (const row of existing) {
    const key = mappingKey(row.brandKey, row.destinationKey);

    if (templatePairs.has(key)) {
      continue;
    }

    if (row.deletedAt !== null) {
      entries.push(entry("media_brand_destination_account", key, "unchanged"));
      continue;
    }

    if (run.mode === "apply") {
      await tx
        .update(mediaBrandDestinationAccount)
        .set({ deletedAt: run.at })
        .where(eq(mediaBrandDestinationAccount.id, row.id));
    }

    entries.push(entry("media_brand_destination_account", key, "retired"));
  }

  return { entries };
}

// jsonb normalizes object key order; compare as sorted pairs, not serialized text.
function canonicalMetadata(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return "";
  }

  return Object.entries(value)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, field]) => `${key}=${JSON.stringify(field)}`)
    .join(" ");
}
