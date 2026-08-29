import "server-only";

import { createLocalAccountIssuer } from "better-auth/db";

import { auth } from "./index";

export type OperatorPasswordPolicy = {
  minPasswordLength: number;
  maxPasswordLength: number;
};

type PasswordRejected = {
  status: "password-rejected";
  policy: OperatorPasswordPolicy;
};

export type CreateOperatorResult =
  | { status: "created"; userId: string; email: string }
  | { status: "email-taken" }
  | PasswordRejected;

export type ResetOperatorPasswordResult =
  | { status: "reset"; userId: string; email: string }
  | { status: "not-found" }
  | { status: "no-credential-account" }
  | PasswordRejected;

const CREDENTIAL_PROVIDER = "credential";
const CREDENTIAL_ISSUER = createLocalAccountIssuer(CREDENTIAL_PROVIDER);

export async function operatorPasswordPolicy(): Promise<OperatorPasswordPolicy> {
  const { password } = await auth.$context;

  return password.config;
}

function rejectPassword(
  password: string,
  policy: OperatorPasswordPolicy,
): PasswordRejected | null {
  return password.length < policy.minPasswordLength ||
    password.length > policy.maxPasswordLength
    ? { status: "password-rejected", policy }
    : null;
}

// `disableSignUp` closes /sign-up/email, including these commands; use the internal adapter.
export async function createOperatorAccount(input: {
  email: string;
  name: string;
  password: string;
}): Promise<CreateOperatorResult> {
  const ctx = await auth.$context;
  const rejected = rejectPassword(input.password, ctx.password.config);
  if (rejected) return rejected;

  const existing = await ctx.internalAdapter.findUserByEmail(input.email, {
    includeAccounts: true,
  });

  if (existing) {
    if (
      existing.accounts.some(
        (account) => account.providerId === CREDENTIAL_PROVIDER,
      )
    ) {
      return { status: "email-taken" };
    }

    // Provisioning that failed between createUser and linkAccount leaves a
    // sign-in-less row, and `disableSignUp` leaves this command as its only repair.
    await ctx.internalAdapter.linkAccount({
      accountId: existing.user.id,
      issuer: CREDENTIAL_ISSUER,
      password: await ctx.password.hash(input.password),
      providerId: CREDENTIAL_PROVIDER,
      userId: existing.user.id,
    });

    return {
      status: "created",
      userId: existing.user.id,
      email: existing.user.email,
    };
  }

  const hash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser(
    {
      email: input.email,
      emailVerified: false,
      name: input.name,
    },
    { method: "admin" },
  );

  await ctx.internalAdapter.linkAccount({
    accountId: user.id,
    issuer: CREDENTIAL_ISSUER,
    password: hash,
    providerId: CREDENTIAL_PROVIDER,
    userId: user.id,
  });

  return { status: "created", userId: user.id, email: user.email };
}

export async function resetOperatorPassword(input: {
  email: string;
  password: string;
}): Promise<ResetOperatorPasswordResult> {
  const ctx = await auth.$context;
  const rejected = rejectPassword(input.password, ctx.password.config);
  if (rejected) return rejected;

  const existing = await ctx.internalAdapter.findUserByEmail(input.email, {
    includeAccounts: true,
  });

  if (!existing) return { status: "not-found" };
  if (
    !existing.accounts.some(
      (account) => account.providerId === CREDENTIAL_PROVIDER,
    )
  ) {
    return { status: "no-credential-account" };
  }

  const hash = await ctx.password.hash(input.password);
  await ctx.internalAdapter.updatePassword(existing.user.id, hash);
  await ctx.internalAdapter.deleteUserSessions(existing.user.id);

  return {
    status: "reset",
    userId: existing.user.id,
    email: existing.user.email,
  };
}
