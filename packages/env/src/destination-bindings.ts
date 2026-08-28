import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";

type TemplateDestination = CustomerTemplate["destinationAccounts"][number];

export type DestinationPlatform = TemplateDestination["platform"];

// Reports name the missing-credential category, never the env variable that would hold it.
export type BindingField =
  | "access_token"
  | "access_token_secret"
  | "application_key"
  | "application_secret"
  | "bot_token"
  | "system_user_access_token";

export type BindableDestination = {
  key: string;
  platform: DestinationPlatform;
  enabled: boolean;
  retired: boolean;
};

export type DestinationBindingStatus = "bound" | "unbound" | "inactive";

export type DestinationBinding = {
  key: string;
  platform: DestinationPlatform;
  status: DestinationBindingStatus;
  missing: readonly BindingField[];
};

export type DeploymentBinding = {
  platform: DestinationPlatform;
  missing: readonly BindingField[];
};

export type DestinationBindingReport = {
  destinations: readonly DestinationBinding[];
  deployment: readonly DeploymentBinding[];
  satisfied: boolean;
};

export class DestinationBindingError extends Error {
  readonly code = "DUPLICATE_ENV_PREFIX";

  constructor(message: string) {
    super(message);
    this.name = "DestinationBindingError";
  }
}

class DestinationCredentialError extends Error {
  readonly code:
    | "DESTINATION_DISABLED"
    | "DESTINATION_UNBOUND"
    | "DESTINATION_UNSUPPORTED";

  constructor(code: DestinationCredentialError["code"]) {
    super(code);
    this.name = "DestinationCredentialError";
    this.code = code;
  }
}

export type DestinationCredential =
  | {
      platform: "telegram";
      botToken: string;
      channel: string;
    }
  | {
      platform: "x";
      accessToken: string;
      accessTokenSecret: string;
      applicationKey: string;
      applicationSecret: string;
    }
  | {
      platform: "instagram";
      professionalAccountId: string;
      systemUserAccessToken: string;
    };

type BindingRequirement = { field: BindingField; variable: string };

function envPrefix(key: string) {
  return key.replaceAll("-", "_").toUpperCase();
}

function destinationRequirements(
  platform: DestinationPlatform,
  prefix: string,
): readonly BindingRequirement[] {
  switch (platform) {
    case "telegram":
      return [{ field: "bot_token", variable: `DEST_${prefix}_BOT_TOKEN` }];
    case "x":
      return [
        { field: "access_token", variable: `DEST_${prefix}_ACCESS_TOKEN` },
        {
          field: "access_token_secret",
          variable: `DEST_${prefix}_ACCESS_TOKEN_SECRET`,
        },
      ];
    // Instagram uses one deployment-wide Meta system-user token, not a per-key secret.
    case "instagram":
      return [];
  }
}

function deploymentRequirements(
  platform: DestinationPlatform,
): readonly BindingRequirement[] {
  switch (platform) {
    case "telegram":
      return [];
    case "x":
      return [
        { field: "application_key", variable: "X_API_KEY" },
        { field: "application_secret", variable: "X_API_SECRET" },
      ];
    case "instagram":
      return [
        {
          field: "system_user_access_token",
          variable: "META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN",
        },
      ];
  }
}

function isPresent(
  runtimeEnv: Record<string, string | undefined>,
  variable: string,
) {
  return (runtimeEnv[variable] ?? "").trim() !== "";
}

function requiredValue(
  runtimeEnv: Record<string, string | undefined>,
  variable: string,
) {
  const value = runtimeEnv[variable]?.trim();
  if (!value) throw new DestinationCredentialError("DESTINATION_UNBOUND");
  return value;
}

export function resolveDestinationCredential(
  destination: TemplateDestination,
  runtimeEnv: Record<string, string | undefined>,
): DestinationCredential {
  if (!destination.enabled) {
    throw new DestinationCredentialError("DESTINATION_DISABLED");
  }

  const prefix = envPrefix(destination.key);
  switch (destination.platform) {
    case "telegram": {
      const channel = destination.metadata.channel?.trim();
      if (!channel) {
        throw new DestinationCredentialError("DESTINATION_UNBOUND");
      }
      return {
        platform: "telegram",
        botToken: requiredValue(runtimeEnv, `DEST_${prefix}_BOT_TOKEN`),
        channel,
      };
    }
    case "x":
      return {
        platform: "x",
        accessToken: requiredValue(runtimeEnv, `DEST_${prefix}_ACCESS_TOKEN`),
        accessTokenSecret: requiredValue(
          runtimeEnv,
          `DEST_${prefix}_ACCESS_TOKEN_SECRET`,
        ),
        applicationKey: requiredValue(runtimeEnv, "X_API_KEY"),
        applicationSecret: requiredValue(runtimeEnv, "X_API_SECRET"),
      };
    case "instagram":
      return {
        platform: "instagram",
        professionalAccountId: destination.metadata.professionalAccountId,
        systemUserAccessToken: requiredValue(
          runtimeEnv,
          "META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN",
        ),
      };
    default:
      throw new DestinationCredentialError("DESTINATION_UNSUPPORTED");
  }
}

function missingFields(
  requirements: readonly BindingRequirement[],
  runtimeEnv: Record<string, string | undefined>,
) {
  return requirements
    .filter((requirement) => !isPresent(runtimeEnv, requirement.variable))
    .map((requirement) => requirement.field);
}

// Keys that fold to one prefix would silently share a credential.
function assertUniquePrefixes(destinations: readonly BindableDestination[]) {
  const keyByPrefix = new Map<string, string>();

  for (const destination of destinations) {
    const prefix = envPrefix(destination.key);
    const claimed = keyByPrefix.get(prefix);

    if (claimed !== undefined) {
      throw new DestinationBindingError(
        `destination keys "${claimed}" and "${destination.key}" resolve to the same deployment binding`,
      );
    }

    keyByPrefix.set(prefix, destination.key);
  }
}

export function resolveDestinationBindings(
  destinations: readonly BindableDestination[],
  runtimeEnv: Record<string, string | undefined>,
): DestinationBindingReport {
  assertUniquePrefixes(destinations);

  const activePlatforms = new Set<DestinationPlatform>();

  for (const destination of destinations) {
    if (destination.enabled && !destination.retired) {
      activePlatforms.add(destination.platform);
    }
  }

  const deployment = [...activePlatforms]
    .map((platform) => ({
      platform,
      missing: missingFields(deploymentRequirements(platform), runtimeEnv),
    }))
    .filter((entry) => entry.missing.length > 0);

  const deploymentUnbound = new Set(deployment.map((entry) => entry.platform));

  const bindings = destinations.map((destination): DestinationBinding => {
    const { key, platform } = destination;

    if (!destination.enabled || destination.retired) {
      return { key, platform, status: "inactive", missing: [] };
    }

    const missing = missingFields(
      destinationRequirements(platform, envPrefix(key)),
      runtimeEnv,
    );
    const bound = missing.length === 0 && !deploymentUnbound.has(platform);

    return { key, platform, status: bound ? "bound" : "unbound", missing };
  });

  return {
    destinations: bindings,
    deployment,
    satisfied: bindings.every((binding) => binding.status !== "unbound"),
  };
}

const PLATFORM_WIDTH = 9;

export function formatDestinationBindingReport(
  report: DestinationBindingReport,
) {
  const counts = (["bound", "unbound", "inactive"] as const).map((status) => {
    const total = report.destinations.filter(
      (binding) => binding.status === status,
    ).length;

    return `${status} ${total}`;
  });

  const lines = [`destination bindings: ${counts.join("  ")}`];

  for (const entry of report.deployment) {
    lines.push(
      `  deployment  ${entry.platform.padEnd(PLATFORM_WIDTH)} missing ${entry.missing.join(", ")}`,
    );
  }

  for (const binding of report.destinations) {
    if (binding.status !== "unbound") {
      continue;
    }

    const missing =
      binding.missing.length > 0
        ? `missing ${binding.missing.join(", ")}`
        : "missing deployment binding";

    lines.push(
      `  unbound     ${binding.platform.padEnd(PLATFORM_WIDTH)} ${binding.key} ${missing}`,
    );
  }

  lines.push(
    report.satisfied
      ? "every active destination is bound"
      : "active destinations are missing bindings",
  );

  return lines.join("\n");
}
