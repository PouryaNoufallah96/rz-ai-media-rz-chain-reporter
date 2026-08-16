import { z } from "zod";

export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "nameTooShort" })
    .max(120, { error: "nameTooLong" }),
  email: z.email({ error: "emailInvalid" }),
  password: z.string().min(8, { error: "passwordTooShort" }),
});

export type SignUpInput = z.input<typeof signUpSchema>;
