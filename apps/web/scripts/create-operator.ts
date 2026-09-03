import {
  createOperatorAccount,
  operatorPasswordPolicy,
} from "@rz-chain-reporter/auth/operator-accounts";
import { z } from "zod";

import { readNewPassword } from "./operator-prompt";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function createOperator() {
  const validateOnly = process.argv[2] === "--validate-email";
  const email = process.argv[validateOnly ? 3 : 2];
  const name = process.argv[3];

  if (!email || !z.email().safeParse(email).success) {
    fail(
      validateOnly
        ? "Invalid operator email."
        : "Usage: operator:create <email> [name]",
    );
  }
  if (validateOnly) return;

  const password = await readNewPassword(await operatorPasswordPolicy());
  if (password === null) process.exit(1);

  const result = await createOperatorAccount({
    email,
    name: name ?? email,
    password,
  });

  switch (result.status) {
    case "created":
      console.log(`Created operator ${result.email} (${result.userId}).`);
      return;
    case "email-taken":
      fail(`An operator account already exists for ${email}.`);
      break;
    case "password-rejected":
      fail(
        `The password must be between ${result.policy.minPasswordLength} and ${result.policy.maxPasswordLength} characters.`,
      );
  }
}

// tsx compiles this to CJS (no top-level await); the auth pool needs an explicit exit.
createOperator().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
