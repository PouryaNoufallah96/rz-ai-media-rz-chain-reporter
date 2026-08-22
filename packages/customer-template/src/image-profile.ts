import { z } from "zod";

// Family, axis, and axis-value keys are customer data: validate shape, not vocabulary.
const profileKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "Expected a lowercase underscored key");

const prose = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "Expected no surrounding whitespace",
  );

const familySchema = z.strictObject({
  name: prose,
  skeleton: prose,
  textPolicy: prose,
  defaultAxes: z.record(profileKeySchema, profileKeySchema),
  dataBudget: z.int().min(0),
  headlineTreatment: prose.optional(),
  headlineUppercase: z.boolean().optional(),
  dataValueMaxLength: z.int().positive().optional(),
});

const axisClauseSchema = z.strictObject({
  families: z.array(profileKeySchema).min(1),
  energies: z.array(profileKeySchema).min(1).optional(),
  environments: z.array(profileKeySchema).min(1).optional(),
});

export const imageProfileSchema = z
  .strictObject({
    families: z.record(profileKeySchema, familySchema),
    // An axis value may carry no injected description; the empty string is the
    // authored way to say "this value adds nothing to the scene".
    axes: z.record(profileKeySchema, z.record(profileKeySchema, z.string())),
    frozenStyle: z.strictObject({
      format: prose,
      palette: prose,
      materials: prose,
      rendering: prose,
      backgroundVocab: prose,
      headlineZone: prose,
      never: prose,
    }),
    restrictions: z.strictObject({
      antiRepetition: prose,
      moodAccentDefault: profileKeySchema,
      moodAccentRestricted: z.record(profileKeySchema, axisClauseSchema),
      environmentRestricted: z
        .record(profileKeySchema, axisClauseSchema)
        .optional(),
      optionalAxes: z.array(profileKeySchema).min(1).optional(),
      bannedSubjectTerms: z.array(prose).min(1).optional(),
    }),
    textPolicy: z.strictObject({
      rules: prose,
      headlineMaxWords: z.int().positive(),
      headlineUppercase: z.boolean().optional(),
      legibilityLine: prose,
      dataElementTemplate: z.string().min(1),
      // Leading whitespace is load-bearing: the fragment is appended inline.
      dataElementLabelTemplate: z.string().min(1),
      noTextMode: profileKeySchema.optional(),
      noTextLine: prose.optional(),
    }),
    fallbackBrief: z.record(
      profileKeySchema,
      z.union([z.string(), z.array(z.string())]),
    ),
    briefExamples: prose.optional(),
  })
  .superRefine((profile, ctx) => {
    const familyKeys = new Set(Object.keys(profile.families));

    if (familyKeys.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["families"],
        message: "Expected at least one layout family",
      });
    }

    for (const [familyKey, family] of Object.entries(profile.families)) {
      for (const [axisName, axisValue] of Object.entries(family.defaultAxes)) {
        const axis = profile.axes[axisName];

        if (!axis) {
          ctx.addIssue({
            code: "custom",
            path: ["families", familyKey, "defaultAxes", axisName],
            message: `Unknown axis "${axisName}"`,
          });
          continue;
        }

        if (!(axisValue in axis)) {
          ctx.addIssue({
            code: "custom",
            path: ["families", familyKey, "defaultAxes", axisName],
            message: `Unknown value "${axisValue}" on axis "${axisName}"`,
          });
        }
      }
    }

    for (const [clauseName, clause] of Object.entries(
      profile.restrictions.moodAccentRestricted,
    )) {
      reportUnknownFamilies(ctx, familyKeys, clause.families, [
        "restrictions",
        "moodAccentRestricted",
        clauseName,
      ]);
    }

    for (const [clauseName, clause] of Object.entries(
      profile.restrictions.environmentRestricted ?? {},
    )) {
      reportUnknownFamilies(ctx, familyKeys, clause.families, [
        "restrictions",
        "environmentRestricted",
        clauseName,
      ]);
    }

    for (const axisName of profile.restrictions.optionalAxes ?? []) {
      if (!(axisName in profile.axes)) {
        ctx.addIssue({
          code: "custom",
          path: ["restrictions", "optionalAxes"],
          message: `Unknown axis "${axisName}"`,
        });
      }
    }

    const fallbackFamily = profile.fallbackBrief.family;

    if (typeof fallbackFamily !== "string" || !familyKeys.has(fallbackFamily)) {
      ctx.addIssue({
        code: "custom",
        path: ["fallbackBrief", "family"],
        message: "Expected a declared layout family",
      });
    }

    const optionalAxes = new Set(profile.restrictions.optionalAxes ?? []);

    for (const [key, value] of Object.entries(profile.fallbackBrief)) {
      const axis = profile.axes[key];

      if (!axis || typeof value !== "string" || optionalAxes.has(key)) {
        continue;
      }

      if (!(value in axis)) {
        ctx.addIssue({
          code: "custom",
          path: ["fallbackBrief", key],
          message: `Unknown value "${value}" on axis "${key}"`,
        });
      }
    }
  });

export type ImageProfile = z.infer<typeof imageProfileSchema>;

function reportUnknownFamilies(
  ctx: z.RefinementCtx,
  familyKeys: ReadonlySet<string>,
  families: readonly string[],
  path: (string | number)[],
) {
  for (const [index, familyKey] of families.entries()) {
    if (!familyKeys.has(familyKey)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "families", index],
        message: `Unknown layout family "${familyKey}"`,
      });
    }
  }
}
