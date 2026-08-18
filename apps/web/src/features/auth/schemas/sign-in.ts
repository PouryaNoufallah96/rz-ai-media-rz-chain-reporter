import { z } from "zod";

export const signInSchema = z.object({
  email: z.email({ error: "emailInvalid" }),
  password: z.string().min(1, { error: "passwordRequired" }),
  rememberMe: z.boolean().default(false),
});

export type SignInInput = z.input<typeof signInSchema>;
