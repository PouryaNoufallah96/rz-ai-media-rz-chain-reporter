"use server";

import { createRequestContext } from "@/server/rpc/context";
import { signIn, signOut } from "@/server/rpc/routers/auth";

export const signInAction = signIn.actionable({
  context: createRequestContext,
});
export const signOutAction = signOut.actionable({
  context: createRequestContext,
});
