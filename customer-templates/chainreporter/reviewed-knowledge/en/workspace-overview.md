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
5. This installation has configured Telegram and X destination accounts for direct or scheduled publishing. Instagram remains an editorial platform for preparing copy and visuals, but this installation has no Instagram destination account and therefore cannot publish there.
6. Account (`/account`) shows the operator profile, workspace and per-brand counts, recent activity and topics, schedule history, and saved cards; `/saved` redirects there and preserves its state. Schedule (`/schedule`) is the full dispatch, retry, and reconciliation desk. On Sources (`/sources`), choose enabled feeds or channels and import options, start one import, then review the current or recent per-source outcomes, catalog and imported-item stream. Usage (`/usage`) reports model and provider consumption.

The assistant explains documented features and reads one bounded view of workspace or operator records at a time. A read appears as a compact chat card with safe media previews where available and an Open link to the native desk; it does not embed a full desk or Card Sheet. It can prepare one News or Promo run, and only the proposal's explicit Approve control can start it. Market Analysis is disabled in this installation. Sources is guidance-only in chat. Editorial and Card Sheet changes, content approval, publishing, scheduling, and cancel or reschedule actions stay in their native desks. The assistant cannot perform those desk actions, run multi-item writes, or replace operator review.
