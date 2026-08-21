import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveArtifactRoot(moduleUrl: string) {
  const workingDirectory = process.cwd();
  if (existsSync(`${workingDirectory}/customer-templates`)) {
    return workingDirectory;
  }

  const repositoryRoot = fileURLToPath(new URL("../../../../", moduleUrl));
  if (existsSync(`${repositoryRoot}/customer-templates`)) {
    return repositoryRoot;
  }

  throw new Error("customer template artifact root not found");
}
