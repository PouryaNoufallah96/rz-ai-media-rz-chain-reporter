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

const fallbackBriefSchema = z.strictObject({
  selection: z.strictObject({
    family: profileKeySchema,
    axes: z.record(profileKeySchema, profileKeySchema.nullable()),
  }),
  brief: z.strictObject({
    headline: prose,
    subjectScene: prose,
    dataElements: z.array(
      z.strictObject({
        value: prose,
        label: prose,
      }),
    ),
  }),
});

export const frozenStyleSchema = z.strictObject({
  format: prose,
  palette: prose,
  materials: prose,
  rendering: prose,
  backgroundVocab: prose,
  headlineZone: prose,
  never: prose,
});

export const imageProfileSchema = z
  .strictObject({
    families: z.record(profileKeySchema, familySchema),
    // An axis value may carry no injected description; the empty string is the
    // authored way to say "this value adds nothing to the scene".
    axes: z.record(profileKeySchema, z.record(profileKeySchema, z.string())),
    frozenStyle: frozenStyleSchema,
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
    output: z.strictObject({
      width: z.int().positive(),
      height: z.int().positive(),
      format: z.literal("png"),
    }),
    logo: z.strictObject({
      anchor: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
      widthShortSideRatio: z.number().positive().max(1),
      insetShortSideRatio: z.number().nonnegative().max(0.5),
    }),
    fallbackBrief: fallbackBriefSchema,
    briefExamples: prose.optional(),
  })
  .superRefine((profile, ctx) => {
    const familyKeys = new Set(Object.keys(profile.families));
    const axesByValue = new Map<string, string[]>();

    for (const [axisName, values] of Object.entries(profile.axes)) {
      for (const value of Object.keys(values)) {
        const axes = axesByValue.get(value) ?? [];
        axes.push(axisName);
        axesByValue.set(value, axes);
      }
    }

    if (familyKeys.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["families"],
        message: "Expected at least one layout family",
      });
    }

    reportRestrictionValue(
      ctx,
      axesByValue,
      profile.restrictions.moodAccentDefault,
      ["restrictions", "moodAccentDefault"],
    );

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
      reportRestrictionValue(ctx, axesByValue, clauseName, [
        "restrictions",
        "moodAccentRestricted",
        clauseName,
      ]);
      reportUnknownFamilies(ctx, familyKeys, clause.families, [
        "restrictions",
        "moodAccentRestricted",
        clauseName,
      ]);
      reportUnknownAxisValues(
        ctx,
        profile.axes.energy,
        clause.energies,
        "energy",
        ["restrictions", "moodAccentRestricted", clauseName, "energies"],
      );
      reportUnknownAxisValues(
        ctx,
        profile.axes.environment,
        clause.environments,
        "environment",
        ["restrictions", "moodAccentRestricted", clauseName, "environments"],
      );
    }

    for (const [clauseName, clause] of Object.entries(
      profile.restrictions.environmentRestricted ?? {},
    )) {
      reportRestrictionValue(ctx, axesByValue, clauseName, [
        "restrictions",
        "environmentRestricted",
        clauseName,
      ]);
      reportUnknownFamilies(ctx, familyKeys, clause.families, [
        "restrictions",
        "environmentRestricted",
        clauseName,
      ]);
      reportUnknownAxisValues(
        ctx,
        profile.axes.energy,
        clause.energies,
        "energy",
        ["restrictions", "environmentRestricted", clauseName, "energies"],
      );
      reportUnknownAxisValues(
        ctx,
        profile.axes.environment,
        clause.environments,
        "environment",
        ["restrictions", "environmentRestricted", clauseName, "environments"],
      );
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

    const fallbackFamily = profile.fallbackBrief.selection.family;

    if (!familyKeys.has(fallbackFamily)) {
      ctx.addIssue({
        code: "custom",
        path: ["fallbackBrief", "selection", "family"],
        message: "Expected a declared layout family",
      });
    }

    const optionalAxes = new Set(profile.restrictions.optionalAxes ?? []);
    const fallbackAxes = profile.fallbackBrief.selection.axes;

    for (const [axisName, axis] of Object.entries(profile.axes)) {
      const selected = fallbackAxes[axisName];

      if (selected === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["fallbackBrief", "selection", "axes", axisName],
          message: "Expected a normalized fallback axis",
        });
        continue;
      }

      if (selected === null) {
        if (!optionalAxes.has(axisName)) {
          ctx.addIssue({
            code: "custom",
            path: ["fallbackBrief", "selection", "axes", axisName],
            message: "Expected an allowed value for a required axis",
          });
        }
        continue;
      }

      if (!(selected in axis)) {
        ctx.addIssue({
          code: "custom",
          path: ["fallbackBrief", "selection", "axes", axisName],
          message: `Unknown value "${selected}" on axis "${axisName}"`,
        });
      }
    }

    for (const axisName of Object.keys(fallbackAxes)) {
      if (!(axisName in profile.axes)) {
        ctx.addIssue({
          code: "custom",
          path: ["fallbackBrief", "selection", "axes", axisName],
          message: `Unknown fallback axis "${axisName}"`,
        });
      }
    }

    const family = profile.families[fallbackFamily];

    if (
      family !== undefined &&
      profile.fallbackBrief.brief.dataElements.length > family.dataBudget
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fallbackBrief", "brief", "dataElements"],
        message: "Fallback data elements exceed the selected family budget",
      });
    }
  });

export type ImageProfile = z.infer<typeof imageProfileSchema>;

// The worker sends this and the load-time size guard measures it: one owner.
export function imageSelectionPromptPayload(profile: ImageProfile) {
  return JSON.stringify({
    families: profile.families,
    axes: profile.axes,
    restrictions: {
      antiRepetition: profile.restrictions.antiRepetition,
      moodAccentDefault: profile.restrictions.moodAccentDefault,
      moodAccentRestricted: profile.restrictions.moodAccentRestricted,
      environmentRestricted: profile.restrictions.environmentRestricted,
    },
  });
}

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

function reportUnknownAxisValues(
  ctx: z.RefinementCtx,
  axis: Readonly<Record<string, string>> | undefined,
  values: readonly string[] | undefined,
  axisName: string,
  path: (string | number)[],
) {
  for (const [index, value] of (values ?? []).entries()) {
    if (!(value in (axis ?? {}))) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Unknown value "${value}" on axis "${axisName}"`,
      });
    }
  }
}

function reportRestrictionValue(
  ctx: z.RefinementCtx,
  axesByValue: ReadonlyMap<string, readonly string[]>,
  value: string,
  path: (string | number)[],
) {
  const axes = axesByValue.get(value) ?? [];

  if (axes.length === 0) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `Unknown axis value "${value}"`,
    });
  } else if (axes.length > 1) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `Ambiguous axis value "${value}" appears on ${axes.join(", ")}`,
    });
  }
}
