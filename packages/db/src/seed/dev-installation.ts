// Fixed UUIDv7s sharing the workspace seed's timestamp, so a reseed resolves the
// same synthetic media brands, destination accounts, and sources.
export const DEV_CHAIN_REPORTER_BRAND_ID =
  "019b76da-a800-7000-8000-000000000012";

export const DEV_MEDIA_BRANDS = [
  {
    id: "019b76da-a800-7000-8000-000000000010",
    key: "rz-prime",
    name: "RZ Prime",
    sortOrder: 1,
  },
  {
    id: "019b76da-a800-7000-8000-000000000011",
    key: "coin-hall",
    name: "Coin Hall",
    sortOrder: 2,
  },
  {
    id: DEV_CHAIN_REPORTER_BRAND_ID,
    key: "chain-reporter",
    name: "ChainReporter",
    sortOrder: 3,
  },
  {
    id: "019b76da-a800-7000-8000-000000000013",
    key: "meta-coin-guard",
    name: "Meta Coin Guard",
    sortOrder: 4,
  },
] as const;

// Keys only: deployment configuration resolves each to a credential, so no
// token, channel identifier, or variable name belongs in this file.
export const DEV_DESTINATION_ACCOUNTS = [
  {
    id: "019b76da-a800-7000-8000-000000000020",
    key: "chainreporter-telegram",
    platform: "telegram",
  },
  {
    id: "019b76da-a800-7000-8000-000000000021",
    key: "chainreporter-x",
    platform: "x",
  },
] as const;

// The crypto customer's source set, covering both origins an adapter exists for.
// `endpoint` is a public feed URL or a public channel handle, never a credential.
// `enabled` is stated per row rather than defaulted, because which configured
// sources a run reads is a template decision a reader should not have to infer.
export const DEV_SOURCES = [
  {
    id: "019b76da-a800-7000-8000-000000000030",
    key: "coindesk-rss",
    origin: "rss",
    endpoint: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    name: "CoinDesk",
    enabled: true,
  },
  {
    id: "019b76da-a800-7000-8000-000000000031",
    key: "cointelegraph-rss",
    origin: "rss",
    endpoint: "https://cointelegraph.com/rss",
    name: "Cointelegraph",
    enabled: true,
  },
  {
    id: "019b76da-a800-7000-8000-000000000032",
    key: "the-block-rss",
    origin: "rss",
    endpoint: "https://www.theblock.co/rss.xml",
    name: "The Block",
    enabled: true,
  },
  {
    id: "019b76da-a800-7000-8000-000000000033",
    key: "decrypt-rss",
    origin: "rss",
    endpoint: "https://decrypt.co/feed",
    name: "Decrypt",
    enabled: false,
  },
  {
    id: "019b76da-a800-7000-8000-000000000034",
    key: "cointelegraph-telegram",
    origin: "telegram_public",
    endpoint: "cointelegraph",
    name: "Cointelegraph Channel",
    enabled: true,
  },
] as const;
