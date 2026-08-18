import "server-only";

import { CUSTOMER_TEMPLATE_SCHEMA_VERSION } from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { liveInWorkspace } from "@rz-chain-reporter/db/filters";

import { FINGERPRINT_DISPLAY_LENGTH } from "../constants";
import {
  type DestinationBindingState,
  destinationMetadataSchema,
  type InstallationOverview,
  instagramMetadataSchema,
} from "../schemas/installation-overview";

export async function readInstallationOverview(
  executor: Executor,
  workspaceId: string,
): Promise<InstallationOverview> {
  const [identity, brands, sources, destinations] = await Promise.all([
    findWorkspaceIdentity(executor, workspaceId),
    listMediaBrands(executor, workspaceId),
    listSources(executor, workspaceId),
    listDestinationAccounts(executor, workspaceId),
  ]);

  if (!identity) {
    throw new Error("the installation's workspace row disappeared mid-request");
  }

  return {
    identity: {
      workspaceName: identity.name,
      templateKey: identity.customerTemplateKey,
      templateSchemaVersion: CUSTOMER_TEMPLATE_SCHEMA_VERSION,
      templateFingerprintShort:
        identity.customerTemplateFingerprint?.slice(
          0,
          FINGERPRINT_DISPLAY_LENGTH,
        ) ?? null,
      templateAppliedAt: identity.customerTemplateAppliedAt,
    },
    mediaBrands: brands.map((brand) => ({
      key: brand.key,
      name: brand.name,
      destinationKeys: brand.destinationAccounts
        .filter((mapping) => mapping.destinationAccount.deletedAt === null)
        .map((mapping) => mapping.destinationAccount.key)
        .sort(),
    })),
    sources,
    destinations: destinations.map(toDestination),
  };
}

function findWorkspaceIdentity(executor: Executor, workspaceId: string) {
  return executor.query.workspace.findFirst({
    columns: {
      name: true,
      customerTemplateKey: true,
      customerTemplateFingerprint: true,
      customerTemplateAppliedAt: true,
    },
    where: (row, { eq }) => eq(row.id, workspaceId),
  });
}

function listMediaBrands(executor: Executor, workspaceId: string) {
  return executor.query.mediaBrand.findMany({
    columns: { key: true, name: true },
    where: (brand) => liveInWorkspace(brand, workspaceId),
    orderBy: (brand, { asc }) => [asc(brand.sortOrder), asc(brand.key)],
    with: {
      destinationAccounts: {
        columns: { destinationAccountId: true },
        where: (mapping) => liveInWorkspace(mapping, workspaceId),
        with: {
          destinationAccount: { columns: { key: true, deletedAt: true } },
        },
      },
    },
  });
}

function listSources(executor: Executor, workspaceId: string) {
  return executor.query.source.findMany({
    columns: {
      key: true,
      name: true,
      origin: true,
      endpoint: true,
      enabled: true,
    },
    where: (row) => liveInWorkspace(row, workspaceId),
    orderBy: (row, { asc }) => asc(row.key),
  });
}

function listDestinationAccounts(executor: Executor, workspaceId: string) {
  return executor.query.destinationAccount.findMany({
    columns: {
      key: true,
      platform: true,
      enabled: true,
      metadata: true,
      bindingPresent: true,
      bindingCheckedAt: true,
    },
    where: (row) => liveInWorkspace(row, workspaceId),
    orderBy: (row, { asc }) => asc(row.key),
  });
}

type DestinationRow = Awaited<
  ReturnType<typeof listDestinationAccounts>
>[number];

function toDestination(
  row: DestinationRow,
): InstallationOverview["destinations"][number] {
  const binding = bindingStateOf(row.enabled, row.bindingPresent);
  const instagram =
    row.platform === "instagram"
      ? instagramMetadataSchema.parse(row.metadata)
      : null;
  const metadata = instagram ?? destinationMetadataSchema.parse(row.metadata);

  return {
    key: row.key,
    label: metadata.label,
    platform: row.platform,
    binding,
    // The projection carries a timestamp only where a verdict was recorded, so
    // an inactive destination has no as-of date to show.
    bindingCheckedAt:
      binding === "bound" || binding === "unbound"
        ? row.bindingCheckedAt
        : null,
    instagram: instagram
      ? {
          professionalAccountId: instagram.professionalAccountId,
          username: instagram.username ?? null,
        }
      : null,
  };
}

function bindingStateOf(
  enabled: boolean,
  bindingPresent: boolean | null,
): DestinationBindingState {
  if (!enabled) {
    return "disabledByTemplate";
  }

  if (bindingPresent === null) {
    return "unchecked";
  }

  return bindingPresent ? "bound" : "unbound";
}
