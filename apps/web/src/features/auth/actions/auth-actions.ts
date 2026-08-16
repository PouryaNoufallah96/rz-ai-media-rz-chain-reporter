"use server";

import { createContext } from "@rz-chain-reporter/api/context";
import { resolveRequestId } from "@rz-chain-reporter/api/request";
import { headers } from "next/headers";

import { signIn, signOut, signUp } from "@/server/rpc/routers/auth";

async function actionContext() {
  const requestHeaders = await headers();
  return createContext(requestHeaders, resolveRequestId(requestHeaders));
}

export const signInAction = signIn.actionable({ context: actionContext });
export const signUpAction = signUp.actionable({ context: actionContext });
export const signOutAction = signOut.actionable({ context: actionContext });
