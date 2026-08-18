import {
  operatorPasswordPolicy,
  resetOperatorPassword,
} from "@rz-chain-reporter/auth/operator-accounts";
import { z } from "zod";

import { readNewPassword } from "./operator-prompt";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function resetPassword() {
  const email = process.argv[2];

  if (!email || !z.email().safeParse(email).success) {
    fail("Usage: operator:reset-password <email>");
  }

  const password = await readNewPassword(await operatorPasswordPolicy());
  if (password === null) process.exit(1);

  const result = await resetOperatorPassword({ email, password });

  switch (result.status) {
    case "reset":
      console.log(
        `Reset the password for ${result.email} (${result.userId}) and signed out its sessions.`,
      );
      return;
    case "not-found":
      fail(`No operator account exists for ${email}.`);
      break;
    case "no-credential-account":
      fail(
        `A user row exists for ${email} with no credential account, so there is no password to reset. Repair it before retrying.`,
      );
      break;
    case "password-rejected":
      fail(
        `The password must be between ${result.policy.minPasswordLength} and ${result.policy.maxPasswordLength} characters.`,
      );
  }
}

resetPassword().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
