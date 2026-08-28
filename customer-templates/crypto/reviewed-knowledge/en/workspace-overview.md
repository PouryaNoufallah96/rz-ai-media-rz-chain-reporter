# ChainReporter workspace overview

ChainReporter is a multi-brand crypto-news social-media workspace. It takes a topic or configured sources, routes stories across four media brands, and prepares social copy and images for Telegram, X, and Instagram.

The four media brands are:

- RZ Prime: token-reservation platform coverage.
- Coin Hall: tokenized real-world-asset deal coverage.
- Meta Coin Guard: automated on-chain token-value protection coverage.
- ChainReporter: mainstream cryptocurrency and macroeconomic news.

Workspace flow:

1. On the Editorial Workspace (`/dashboard`), configure a News Run or a Promo Run. The source subset, recency, enrichment, media brands, destination platforms, editorial models, topics, and Top-N are compact run options there. Then start the run.
2. A News Run filters and scores admitted source items for editorial fit and asks the selected editorial models to choose coverage for each selected media brand. Results arrive as cards in Model Lanes and Telegram Lanes. A Promo Run is source-free and produces Promo Ideas instead.
3. Routing an origin card onto a Platform Lane prepares it for one media brand and one destination platform. A routed card can generate platform-specific copy variants and a branded image.
4. The Card Sheet is where a routed card is worked: copy and hashtag editing, draft revision history, image and media selection, approval, saving, scheduling, and publishing.
5. Publishing targets X, Telegram, and Instagram, either directly or on a schedule. Instagram publishes through an asynchronous media-container workflow.
6. Account (`/account`) shows the operator profile, workspace and per-brand counts, recent activity and topics, schedule history, and saved cards; `/saved` redirects there and preserves its state. Schedule (`/schedule`) is the full dispatch, retry, and reconciliation desk. Sources (`/sources`) owns the source catalog, import history, and per-source outcomes. Usage (`/usage`) reports model and provider consumption.

The assistant explains documented features and the current card context. It cannot click controls, publish, schedule, edit, or otherwise act for the operator.
