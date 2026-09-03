import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import {
  type BindableDestination,
  type DestinationBindingReport,
  resolveDestinationBindings,
} from "@rz-chain-reporter/env/destination-bindings";
import { validateWorkerEnv } from "@rz-chain-reporter/env/worker";
import { resolveMarketProviderBindings } from "../market/bindings";

// Database-free: run before template:reconcile so a missing credential fails first.
export function checkDestinationBindings(
  rootDir: string,
  customerTemplateKey: string,
  runtimeEnv: Record<string, string | undefined>,
): DestinationBindingReport {
  const { template } = loadCustomerTemplate(rootDir, customerTemplateKey);

  return resolveDestinationBindings(
    template.destinationAccounts.map(
      (account): BindableDestination => ({
        key: account.key,
        platform: account.platform,
        enabled: account.enabled,
        retired: false,
      }),
    ),
    runtimeEnv,
  );
}

export function checkMarketProviderBindings(
  rootDir: string,
  customerTemplateKey: string,
  runtimeEnv: Record<string, string | undefined>,
) {
  const { template } = loadCustomerTemplate(rootDir, customerTemplateKey);
  return resolveMarketProviderBindings(template, validateWorkerEnv(runtimeEnv));
}
