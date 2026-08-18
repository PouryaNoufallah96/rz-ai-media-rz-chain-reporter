import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import type { OperatorPasswordPolicy } from "@rz-chain-reporter/auth/operator-accounts";

// Never argv or env: both persist in shell history and `ps` on the customer's box.
export async function readNewPassword(policy: OperatorPasswordPolicy) {
  if (!process.stdin.isTTY) {
    console.error(
      "Run this command interactively: it prompts for the password.",
    );
    return null;
  }

  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (muted) callback();
      else process.stdout.write(chunk, encoding, callback);
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });

  // Prompt on stdout, then mute the interface so readline never echoes keystrokes.
  const ask = async (label: string) => {
    process.stdout.write(`${label}: `);
    muted = true;
    const value = await rl.question("");
    muted = false;
    process.stdout.write("\n");
    return value;
  };

  try {
    const password = await ask(
      `Password (at least ${policy.minPasswordLength} characters)`,
    );
    const confirmation = await ask("Confirm password");

    if (password !== confirmation) {
      console.error("The two entries did not match.");
      return null;
    }

    return password;
  } finally {
    rl.close();
  }
}
