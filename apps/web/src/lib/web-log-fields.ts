const WEB_LOG_TEXT_FIELDS = ["outcome", "requestId", "userId"] as const;

export const WEB_LOG_FIELDS: readonly string[] = WEB_LOG_TEXT_FIELDS;

export type WebLogFields = Partial<
  Record<(typeof WEB_LOG_TEXT_FIELDS)[number], string>
>;
