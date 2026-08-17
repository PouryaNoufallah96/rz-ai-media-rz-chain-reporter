import { auth } from "@rz-chain-reporter/auth";
import { z } from "zod";

// Provisioning tool, not a dev seed: it runs against a real customer
// deployment, so it deliberately carries no NODE_ENV guard.

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function createOperator() {
  const email = process.env.OPERATOR_EMAIL ?? process.argv[2];
  // Password is environment-only: an argument would land in shell history and
  // in `ps` output on the customer's box.
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !z.email().safeParse(email).success) {
    fail(
      "Set OPERATOR_EMAIL to an email address, or pass one as the first argument.",
    );
  }
  if (!password) {
    fail(
      "Set OPERATOR_PASSWORD in the environment. It is never read from an argument.",
    );
  }

  const name = process.env.OPERATOR_NAME ?? process.argv[3] ?? email;
  const ctx = await auth.$context;
  const { minPasswordLength } = ctx.password.config;

  if (password.length < minPasswordLength) {
    fail(`OPERATOR_PASSWORD must be at least ${minPasswordLength} characters.`);
  }

  const existing = await ctx.internalAdapter.findUserByEmail(email, {
    includeAccounts: true,
  });

  if (existing) {
    fail(
      existing.accounts.some((account) => account.providerId === "credential")
        ? `An operator account already exists for ${email}.`
        : `A user row exists for ${email} with no credential account, so it cannot sign in. Repair it before retrying.`,
    );
  }

  // Better Auth owns the hash and the credential account row. `disableSignUp`
  // closes /sign-up/email to every caller including this script, so the
  // internal adapter is the supported path; these are the same two writes
  // sign-up performs and the same two rows sign-in reads.
  const hash = await ctx.password.hash(password);
  const user = await ctx.internalAdapter.createUser({
    email,
    emailVerified: false,
    name,
  });

  await ctx.internalAdapter.linkAccount({
    accountId: user.id,
    password: hash,
    providerId: "credential",
    userId: user.id,
  });

  console.log(`Created operator ${user.email} (${user.id}).`);
}

// apps/web is not `"type": "module"`, so tsx compiles this file to CJS, where
// top-level await is unavailable. The auth module opens a connection pool it
// never exposes, so exit explicitly instead of waiting for an idle event loop.
createOperator().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
