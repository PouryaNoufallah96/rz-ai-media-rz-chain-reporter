import { createHash } from "node:crypto";
import type {
  CreativeImageBrief,
  TemplateSelection,
} from "@rz-chain-reporter/contracts";
import type { ImageProfile } from "@rz-chain-reporter/customer-template/schema";
import { z } from "zod";

export type SelectionValidation =
  | { status: "accepted"; selection: TemplateSelection; signature: string }
  | { status: "policy_rejected"; code: "IMAGE_SELECTION_INVALID" }
  | {
      status: "repeat_rejected";
      code: "IMAGE_SELECTION_REPEATED";
      signature: string;
    };

export function buildSelectionOutputSchema(
  profile: ImageProfile,
): z.ZodType<TemplateSelection> {
  const optional = new Set(profile.restrictions.optionalAxes ?? []);
  const axes = Object.fromEntries(
    Object.entries(profile.axes).map(([axisName, values]) => {
      const allowed = z.enum(Object.keys(values));
      return [
        axisName,
        optional.has(axisName) ? allowed.nullable() : allowed,
      ] as const;
    }),
  );
  return z.strictObject({
    axes: z.strictObject(axes),
    family: z.enum(Object.keys(profile.families)),
  });
}

export function selectionSignature(selection: TemplateSelection) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        family: selection.family,
        axes: Object.fromEntries(
          Object.entries(selection.axes).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      }),
    )
    .digest("hex");
}

export function validateImageSelection(
  profile: ImageProfile,
  candidate: TemplateSelection,
  latestSignatures: readonly string[],
): SelectionValidation {
  const family = profile.families[candidate.family];
  if (!family)
    return { status: "policy_rejected", code: "IMAGE_SELECTION_INVALID" };
  const optional = new Set(profile.restrictions.optionalAxes ?? []);
  const normalizedAxes: Record<string, string | null> = {};
  for (const [axisName, values] of Object.entries(profile.axes)) {
    const selected = candidate.axes[axisName];
    if (selected === null && optional.has(axisName)) {
      normalizedAxes[axisName] = null;
      continue;
    }
    if (typeof selected !== "string" || !(selected in values)) {
      return { status: "policy_rejected", code: "IMAGE_SELECTION_INVALID" };
    }
    normalizedAxes[axisName] = selected;
  }
  if (Object.keys(candidate.axes).some((axis) => !(axis in profile.axes))) {
    return { status: "policy_rejected", code: "IMAGE_SELECTION_INVALID" };
  }
  const selection = { family: candidate.family, axes: normalizedAxes };
  const signature = selectionSignature(selection);
  if (latestSignatures.includes(signature)) {
    return {
      status: "repeat_rejected",
      code: "IMAGE_SELECTION_REPEATED",
      signature,
    };
  }
  return { status: "accepted", selection, signature };
}

export type CreativeBriefFailure = "BANNED_TERM" | "IMAGE_SELECTION_INVALID";

export function normalizeCreativeBrief(
  profile: ImageProfile,
  selection: TemplateSelection,
  brief: CreativeImageBrief,
): { brief: CreativeImageBrief; failures: CreativeBriefFailure[] } {
  const family = profile.families[selection.family];
  if (!family) return { brief, failures: ["IMAGE_SELECTION_INVALID"] };
  const words = brief.headline
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, profile.textPolicy.headlineMaxWords)
    .join(" ");
  const uppercase =
    family.headlineUppercase ?? profile.textPolicy.headlineUppercase ?? false;
  const dataElements = brief.dataElements
    .slice(0, family.dataBudget)
    .map((item) =>
      family.dataValueMaxLength === undefined
        ? item
        : {
            label: item.label,
            value: [...item.value]
              .slice(0, family.dataValueMaxLength)
              .join("")
              .trimEnd(),
          },
    );
  const normalized = {
    dataElements,
    headline: uppercase ? words.toLocaleUpperCase("und") : words,
    subjectScene: brief.subjectScene,
  };
  const material =
    `${normalized.headline}\n${normalized.subjectScene}\n${dataElements
      .map((item) => `${item.value} ${item.label}`)
      .join("\n")}`.toLocaleLowerCase("und");
  const banned = (profile.restrictions.bannedSubjectTerms ?? []).some((term) =>
    material.includes(term.toLocaleLowerCase("und")),
  );
  return { brief: normalized, failures: banned ? ["BANNED_TERM"] : [] };
}

export function deterministicImageFallback(profile: ImageProfile) {
  return {
    brief: profile.fallbackBrief.brief,
    selection: profile.fallbackBrief.selection,
  };
}
