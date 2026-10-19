# Kuro Market Tracker — Design

Date: 2026-10-19

## Intent

The user plays on the Kuro MapleStory private server (playkuro.com). They check the in-game market (https://playkuro.com/market) to decide when to **buy cheap**, when to **sell high**, and to **know what things are worth**. Opening the site and searching each item by hand is tedious. They want:

1. A desktop dashboard that shows how prices for their favourite items move over time.
2. Prices recorded automatically every ~30 minutes, **even when their PC is off**.
3. A quick search box for any item, without opening the website.

They read the trends themselves. No alerts for now.

## Goals

- Track a list of favourite items that the user can edit. The starting list:
  - Dual Blade's Hyper II, Phantom's Hyper II, Dark Knight's Hyper II
  - Mihile's Approval, Irena's Approval, Eckhart's Approval, Oz's Approval, Hawkeye's Approval
  - Dark Fusion Fragment
- Record prices every ~30 minutes in the cloud, independent of the user's PC.
- Dashboard as a **card grid** (user picked layout A over a list + big chart):
  - Live search box across the top.
  - One card per favourite showing:
    - item name and its rule label ("9999 stack" / "per unit")
    - the **cheapest real listing**, large
    - the **typical (median) price**, smaller
    - the % change
    - a mini chart with both lines (cheapest solid, median dashed)
  - Clicking a card opens a full chart with both lines and time-range buttons (24h / 7d / 30d / all, *builder's call on exact ranges*), plus the item's current filtered listings (seller, channel, price, stock).
- Live search: type any item name to see its current listings, filtered by the same rules, with an **Add to favourites** button. Removing a favourite is also possible from the dashboard.
- **Setup must not be fiddly.** This is the user's main anti-goal (details under Setup).

## Non-goals

- Alerts or notifications (maybe later).
- Buying, selling, or logging in to the game or site.
- Mobile access or hosting the dashboard publicly.

## Anti-goals

- **Fiddly setup.** No manual token copy-pasting, no editing config files by hand, no multi-step GitHub UI clicking. One setup command, then one browser login, is the target.
- Charts distorted by troll or outlier listings (see filtering rules).

## The market API (verified 2026-10-19)

- `POST https://playkuro.com/api/market/owl-search`
- Body: `{"itemName": "<text>"}`. Partial names work: `"Approval"` returns all five Approvals, `"Hyper II"` returns every class's Hyper II. The error message says an item ID is also accepted, but the field name for it hasn't been confirmed.
- No login or cookies are needed. A plain `curl` with no browser headers returned 200 through Cloudflare. Response headers include `Access-Control-Allow-Origin: *`.
- Response: `{"success": true, "data": [...], "source": ..., "total": ...}`. Each listing looks like:
  ```json
  {"itemId":4009165,"itemName":"Dark Fusion Fragment","bundles":1,"price":6799,
   "pricePerBundle":6799,"currency":"PERFECT_PITCH","quantityPerBundle":9999,
   "shopOwner":"Weak","shopType":"hired","mapId":910000012,"channel":1}
  ```
- Meaning, confirmed by the user against the site UI, which shows e.g. "1 · 1839 bundles":
  - `quantityPerBundle`: items you get per purchase.
  - `bundles`: how many of those purchases are in stock.
  - `pricePerBundle`: the price for one bundle.
- Every listing seen was priced in `PERFECT_PITCH`. Other currencies probably exist; ignore listings that aren't in Perfect Pitch (*builder's call*).
- The same shop often appears multiple times with identical rows (each row is likely a separate stack in the shop). Keep them; they reflect real stock.
- Searches match by substring, so results must be filtered to the **exact** item name being tracked (e.g. "Dual Blade's Hyper II" must not include "Dual Blade's Hyper I", and vice versa).

## Filtering rules (user-specified)

Each tracked item has one of two rules:

- **per unit**: keep listings with `quantityPerBundle == 1` and `bundles > 1`. Sellers with only 1 in stock are dropped. Price = `pricePerBundle` per single item.
- **9999 stack**: keep only listings with `quantityPerBundle == 9999`. Price = `pricePerBundle` per stack of 9,999.

Default rule for a newly added item (user confirmed): if the name contains "Hyper", use **per unit**; otherwise **9999 stack**. The user can switch an item's rule from the dashboard.

From the filtered listings for each check, record:
- **cheapest**: min price
- **median**: median price
- *(builder's call: also store listing count and total stock; cheap to keep, may be useful later)*

If no listings pass the filter, record that check as empty rather than zero. Charts show a gap.

Decisions from the builder check (Claude's calls):
- **Store aggregates under both rules on every check.** That way, switching an item's rule instantly shows a complete, consistent history under the new rule, with no mixed series. Raw listings are not stored, which keeps the history small.
- **Median = median over distinct (shop, price) pairs.** One shop with 60 identical stacks shouldn't dominate the "typical price most sellers ask". Cheapest is unaffected.
- **Key tracked items on `itemId`**, captured when the item is added, and keep `itemName` for searching and display. This guards against two items sharing a name.
- The user already has a GitHub account (confirmed).

## How it's built (Claude's calls — the user said "you choose")

- **Repo:** a new **public GitHub repo** in the user's account (user chose public: unlimited free Actions minutes; it holds only favourites + public market prices, nothing personal). It holds the code, the favourites list, and the price history.
- **Price checker:**
  - A Python script run by a **GitHub Actions** scheduled workflow, every 30 minutes (`*/30 * * * *`). GitHub's schedules can run 5–15 minutes late; the user accepted this.
  - It reads the favourites list, calls the API, filters, and appends results to the history.
  - It commits the history back to the repo.
  - Batch searches where possible (e.g. one "Approval" search covers five items) to stay polite (*builder's call*).
  - Expected volume: ~10 items × 48 checks/day. Keep history forever; it stays at a few MB per year.
- **Data files** (*builder's call on exact format*, e.g. `favourites.json` and per-item or per-month history files that diff cleanly).
- **Dashboard:**
  - A static web page (HTML/JS, charting library of the builder's choice) served by a **tiny local Python program**.
  - Started from a **desktop shortcut**, which opens the user's normal browser.
  - The local program:
    - serves the page
    - pulls the latest history from the GitHub repo
    - saves favourite changes (add, remove, change rule) back to the repo
  - It uses the GitHub login from setup, via the GitHub CLI's stored credentials, so the user never handles a token.
  - Live search can call the market API directly from the page, since CORS is open, or go through the local program.
- **Setup:** one command or double-click script (`setup`) that:
  1. Installs the GitHub CLI if it's missing (e.g. via `winget`). Python 3.14 and git are already installed on the user's Windows 11 PC.
  2. Runs the GitHub browser login once. This is the only manual step.
  3. Creates the public repo, pushes the code with the starting favourites, and enables the workflow.
  4. Triggers a first price check right away so the dashboard has data.
  5. Creates the desktop shortcut.
- **Fallback:** if GitHub's servers ever get blocked by the site's Cloudflare, the fallback is a local scheduled check on the PC (Windows Task Scheduler). Don't build it unless needed.

## Left to the builder

- File and folder layout, data formats, charting library, visual styling of the card grid.
- Exact time-range buttons and % change baseline (e.g. versus 24h ago).
- Retry and backoff for API errors; how failed checks are logged.
- Number formatting (e.g. 5,500).
