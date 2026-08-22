import { Headers } from "undici";

import type { SafeHttpResponse } from "../fetch/safe-http";
import { readRssAtomFeed } from "./rss-atom";
import { readTelegramChannel } from "./telegram-public";
import type { SourceFetchRequest, SourceFetchResult } from "./types";

const FEED_ENDPOINT = "https://feed.example.test/feed";
const CHANNEL_HANDLE = "cointelegraph";

const feedRequest: SourceFetchRequest = {
  contentLocale: "en",
  endpoint: FEED_ENDPOINT,
  etag: null,
  lastModified: null,
  maxItems: 15,
  name: "Example Feed",
  origin: "rss",
  timeoutMs: 15_000,
};

const channelRequest: SourceFetchRequest = {
  contentLocale: "en",
  endpoint: CHANNEL_HANDLE,
  etag: null,
  lastModified: null,
  maxItems: 15,
  name: "Example Channel",
  origin: "telegram_public",
  timeoutMs: 15_000,
};

const RSS_2_0 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <language>en-US</language>
    <item>
      <title>Bitcoin &amp; Ethereum hold support</title>
      <link>https://feed.example.test/posts/one</link>
      <guid isPermaLink="false">example-guid-1</guid>
      <description>&lt;p&gt;Spot volume rose overnight.&lt;/p&gt;</description>
      <pubDate>Thu, 21 Aug 2026 09:15:00 GMT</pubDate>
    </item>
    <item>
      <title>Second story</title>
      <link>/posts/two</link>
      <guid>example-guid-2</guid>
      <content:encoded><![CDATA[<p>Full body text.</p>]]></content:encoded>
      <pubDate>Thu, 21 Aug 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const NUMERIC_ENTITIES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <language>en-US</language>
    <item>
      <title>Every &#036;HAI burned &#8211; &amp;#036;130 Million left</title>
      <link>https://feed.example.test/posts/entities</link>
      <guid>entities-1</guid>
      <description>Pump fun sold 143,524 &#036;SOL (&#036;12.52M) &mdash; whales&#39; move&#33;</description>
      <pubDate>Thu, 21 Aug 2026 09:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>Example Atom</title>
  <entry>
    <title>Atom entry one</title>
    <id>urn:uuid:entry-1</id>
    <link rel="self" href="https://feed.example.test/atom"/>
    <link rel="alternate" href="https://feed.example.test/posts/atom-one"/>
    <summary>Atom summary one.</summary>
    <published>2026-08-21T07:30:00Z</published>
  </entry>
  <entry>
    <title>Atom entry two</title>
    <id>urn:uuid:entry-2</id>
    <link href="https://feed.example.test/posts/atom-two"/>
    <updated>2026-08-21T06:30:00Z</updated>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://feed.example.test/"><title>Legacy RDF</title></channel>
  <item rdf:about="https://feed.example.test/posts/rdf-one">
    <title>RDF item</title>
    <link>https://feed.example.test/posts/rdf-one</link>
    <dc:date>2026-08-21T05:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

const ENTITY_BOMB = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rss [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY xxe "PWNED">
]>
<rss version="2.0">
  <channel>
    <item>
      <title>&xxe;</title>
      <link>https://feed.example.test/posts/bomb</link>
      <guid>bomb-1</guid>
      <pubDate>Thu, 21 Aug 2026 09:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const MISSING_IDENTITY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Identified</title>
      <link>https://feed.example.test/posts/identified</link>
      <guid>identified-1</guid>
      <pubDate>Thu, 21 Aug 2026 09:15:00 GMT</pubDate>
    </item>
    <item>
      <title>No identity at all</title>
      <description>No guid and no link.</description>
      <pubDate>Thu, 21 Aug 2026 09:10:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const UNDATED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Undated story</title>
      <link>https://feed.example.test/posts/undated</link>
      <guid>undated-1</guid>
    </item>
  </channel>
</rss>`;

const FOREIGN_LANGUAGE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <language>ru</language>
    <item>
      <title>Russian story</title>
      <link>https://feed.example.test/posts/ru</link>
      <guid>ru-1</guid>
      <pubDate>Thu, 21 Aug 2026 09:15:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Quiet</title></channel></rss>`;

function telegramMessage(
  post: string,
  text: string,
  time: string,
  views: string,
) {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${post}" data-view="eyJjIjoxfQ">
<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
<div class="tgme_widget_message_footer compact js-message_footer"><span class="tgme_widget_message_views">${views}</span><time class="time" datetime="${time}">09:15</time></div>
</div></div>`;
}

function telegramPage(messages: string) {
  return `<!DOCTYPE html><html><body><main class="tgme_main"><section class="tgme_channel_history js-message_history">${messages}</section></main></body></html>`;
}

const CHANNEL_PAGE = telegramPage(
  telegramMessage(
    `${CHANNEL_HANDLE}/12345`,
    "Bitcoin holds steady &amp; above support<br/>Second line",
    "2026-08-21T09:15:00+00:00",
    "14.2K",
  ) +
    telegramMessage(
      `${CHANNEL_HANDLE}/12346`,
      "ETF inflows continue",
      "2026-08-21T10:05:00+00:00",
      "976",
    ),
);

const CHANNEL_PAGE_RESTATED = telegramPage(
  telegramMessage(
    `${CHANNEL_HANDLE}/12345`,
    "Bitcoin holds steady &amp; above support<br/>Second line",
    "2026-08-21T09:15:00+00:00",
    "31.7K",
  ),
);

const CHANNEL_PAGE_DRIFTED = telegramPage(
  telegramMessage(
    `${CHANNEL_HANDLE}/12345`,
    "Bitcoin holds steady",
    "2026-08-21T09:15:00+00:00",
    "14.2K",
  ) +
    `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="${CHANNEL_HANDLE}/12347" data-view="eyJjIjoxfQ">
<div class="tgme_widget_post_body">renamed markup with no text node and no time</div>
</div></div>`,
);

const CHANNEL_PAGE_ENTITIES = telegramPage(
  telegramMessage(
    `${CHANNEL_HANDLE}/12348`,
    "Whales sold 871,000 &#036;HYPE (&#036;64.82M)&#33;<br/>Not all are buying &#8212; some sell &amp; wait",
    "2026-08-21T11:00:00+00:00",
    "2.1K",
  ),
);

const CHANNEL_PAGE_EMPTY = telegramPage("");

const GROUP_REDIRECT_PAGE = `<!DOCTYPE html><html><body><div class="tgme_page"><a class="tgme_action_button_new">Join Group</a></div></body></html>`;

type SourceFixture = {
  actual: () => string;
  expected: string;
  name: string;
};

const FIXTURES: readonly SourceFixture[] = [
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(RSS_2_0))),
    expected:
      "outcome=succeeded reason=none items=2 admissions=admitted,admitted ids=example-guid-1,example-guid-2 urls=https://feed.example.test/posts/one,https://feed.example.test/posts/two dates=2026-08-21T09:15:00.000Z,2026-08-21T08:00:00.000Z views=none,none etag=none",
    name: "rss-2.0",
  },
  {
    actual: () => title(readRssAtomFeed(feedRequest, page(RSS_2_0))),
    expected:
      "title=Bitcoin & Ethereum hold support summary=Spot volume rose overnight.",
    name: "rss-2.0-entities-and-markup",
  },
  {
    actual: () => title(readRssAtomFeed(feedRequest, page(NUMERIC_ENTITIES))),
    expected:
      "title=Every $HAI burned – $130 Million left summary=Pump fun sold 143,524 $SOL ($12.52M) — whales' move!",
    name: "rss-numeric-and-named-entities",
  },
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(ATOM))),
    expected:
      "outcome=succeeded reason=none items=2 admissions=admitted,admitted ids=urn:uuid:entry-1,urn:uuid:entry-2 urls=https://feed.example.test/posts/atom-one,https://feed.example.test/posts/atom-two dates=2026-08-21T07:30:00.000Z,2026-08-21T06:30:00.000Z views=none,none etag=none",
    name: "atom",
  },
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(RDF))),
    expected:
      "outcome=rejected reason=parse_failure items=0 admissions=none ids=none urls=none dates=none views=none etag=none",
    name: "rdf-rejected",
  },
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(ENTITY_BOMB))),
    expected:
      "outcome=rejected reason=parse_failure items=0 admissions=none ids=none urls=none dates=none views=none etag=none",
    name: "entity-bomb-rejected",
  },
  {
    actual: () =>
      summarize(
        readRssAtomFeed(
          feedRequest,
          page("", { headers: { etag: 'W/"feed-v7"' }, status: 304 }),
        ),
      ),
    expected:
      'outcome=not_modified reason=none items=0 admissions=none ids=none urls=none dates=none views=none etag=W/"feed-v7"',
    name: "not-modified",
  },
  {
    actual: () =>
      summarize(readRssAtomFeed(feedRequest, page(MISSING_IDENTITY))),
    expected:
      "outcome=partial reason=missing_external_identity items=1 admissions=admitted ids=identified-1 urls=https://feed.example.test/posts/identified dates=2026-08-21T09:15:00.000Z views=none etag=none",
    name: "missing-identity",
  },
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(UNDATED))),
    expected:
      "outcome=succeeded reason=none items=1 admissions=skipped_undated ids=undated-1 urls=https://feed.example.test/posts/undated dates=none views=none etag=none",
    name: "undated",
  },
  {
    actual: () =>
      summarize(readRssAtomFeed(feedRequest, page(FOREIGN_LANGUAGE))),
    expected:
      "outcome=succeeded reason=none items=1 admissions=skipped_language ids=ru-1 urls=https://feed.example.test/posts/ru dates=2026-08-21T09:15:00.000Z views=none etag=none",
    name: "language-mismatch",
  },
  {
    actual: () => summarize(readRssAtomFeed(feedRequest, page(EMPTY_FEED))),
    expected:
      "outcome=skipped reason=empty_feed items=0 admissions=none ids=none urls=none dates=none views=none etag=none",
    name: "empty-feed",
  },
  {
    actual: () =>
      summarize(
        readRssAtomFeed(feedRequest, page("not found", { status: 404 })),
      ),
    expected: "threw fetch_failed",
    name: "feed-non-2xx-throws",
  },
  {
    actual: () =>
      summarize(readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE))),
    expected:
      "outcome=succeeded reason=none items=2 admissions=admitted,admitted ids=cointelegraph/12345,cointelegraph/12346 urls=https://t.me/cointelegraph/12345,https://t.me/cointelegraph/12346 dates=2026-08-21T09:15:00.000Z,2026-08-21T10:05:00.000Z views=14200,976 etag=none",
    name: "telegram-messages",
  },
  {
    actual: () =>
      contentHashes(
        readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE)),
        readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE_RESTATED)),
      ),
    expected: "firstItemHashesEqual=true",
    name: "telegram-views-outside-content-hash",
  },
  {
    actual: () =>
      summarize(
        readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE_DRIFTED)),
      ),
    expected:
      "outcome=partial reason=markup_drift items=1 admissions=admitted ids=cointelegraph/12345 urls=https://t.me/cointelegraph/12345 dates=2026-08-21T09:15:00.000Z views=14200 etag=none",
    name: "telegram-markup-drift",
  },
  {
    actual: () =>
      summarize(
        readTelegramChannel(
          channelRequest,
          channelPage(GROUP_REDIRECT_PAGE, `https://t.me/${CHANNEL_HANDLE}`),
        ),
      ),
    expected:
      "outcome=rejected reason=no_web_preview items=0 admissions=none ids=none urls=none dates=none views=none etag=none",
    name: "telegram-group-redirect",
  },
  {
    actual: () =>
      title(
        readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE_ENTITIES)),
      ),
    expected:
      "title=Whales sold 871,000 $HYPE ($64.82M)! summary=Whales sold 871,000 $HYPE ($64.82M)!\nNot all are buying — some sell & wait",
    name: "telegram-numeric-and-named-entities",
  },
  {
    actual: () =>
      summarize(
        readTelegramChannel(channelRequest, channelPage(CHANNEL_PAGE_EMPTY)),
      ),
    expected:
      "outcome=skipped reason=empty_feed items=0 admissions=none ids=none urls=none dates=none views=none etag=none",
    name: "telegram-empty-channel",
  },
];

export function runSourceFixtures(only?: string) {
  const selected = FIXTURES.filter(
    (fixture) => only === undefined || fixture.name === only,
  );
  if (selected.length === 0) {
    console.log(`unknown parse-feed fixture ${only}`);
    return false;
  }

  let passed = true;

  for (const fixture of selected) {
    let actual: string;
    try {
      actual = fixture.actual();
    } catch (error) {
      actual = `threw ${error instanceof Error ? error.message : "UNKNOWN"}`;
    }
    const ok = actual === fixture.expected;
    passed &&= ok;
    console.log(`${ok ? "PASS" : "FAIL"} parse-feed ${fixture.name}`);
    console.log(`  actual   ${actual}`);
    if (!ok) {
      console.log(`  expected ${fixture.expected}`);
    }
  }

  return passed;
}

function page(
  body: string,
  init: { headers?: Record<string, string>; status?: number } = {},
): SafeHttpResponse {
  return {
    decodedBytes: Buffer.byteLength(body),
    headers: new Headers(init.headers),
    status: init.status ?? 200,
    text: body,
    url: FEED_ENDPOINT,
  };
}

function channelPage(body: string, url?: string): SafeHttpResponse {
  return {
    decodedBytes: Buffer.byteLength(body),
    headers: new Headers(),
    status: 200,
    text: body,
    url: url ?? `https://t.me/s/${CHANNEL_HANDLE}`,
  };
}

function summarize(result: SourceFetchResult) {
  return [
    `outcome=${result.outcome}`,
    `reason=${result.reason ?? "none"}`,
    `items=${result.items.length}`,
    `admissions=${column(result, (item) => item.admission)}`,
    `ids=${column(result, (item) => item.externalId)}`,
    `urls=${column(result, (item) => item.canonicalUrl)}`,
    `dates=${column(result, (item) => item.publishedAt?.toISOString() ?? "none")}`,
    `views=${column(result, (item) => String(item.views ?? "none"))}`,
    `etag=${result.etag ?? "none"}`,
  ].join(" ");
}

function title(result: SourceFetchResult) {
  const [first] = result.items;
  return `title=${first?.title ?? "none"} summary=${first?.summary ?? "none"}`;
}

function contentHashes(first: SourceFetchResult, second: SourceFetchResult) {
  return `firstItemHashesEqual=${first.items[0]?.contentHash === second.items[0]?.contentHash}`;
}

function column(
  result: SourceFetchResult,
  read: (item: SourceFetchResult["items"][number]) => string,
) {
  return result.items.map(read).join(",") || "none";
}
