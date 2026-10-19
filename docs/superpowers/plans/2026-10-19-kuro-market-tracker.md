# Kuro Market Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Kuro market prices for favourite items every 30 minutes on GitHub Actions, and show them in a local card-grid dashboard that also offers a live search box.

**Architecture:**
- A stdlib-only Python package `tracker/` does three things: calls the market API, applies the filtering rules, and appends per-item summaries to `data/history/<itemId>.jsonl`.
- A scheduled GitHub workflow runs it and commits the results.
- A stdlib local server `app/server.py` serves a static dashboard (Chart.js). It syncs with the repo through git, which is authenticated by the GitHub CLI.
- One `setup.bat` handles everything else.

**Tech Stack:**
- Python 3.12+ (stdlib only; tests use `unittest` because pytest is not installed)
- GitHub Actions
- GitHub CLI (`gh`)
- Vanilla HTML/JS with Chart.js 4.4.1 from cdnjs
- PowerShell and .bat for setup

**Spec:** `docs/superpowers/specs/2026-10-19-kuro-market-tracker-design.md`

## Global Constraints

- **Repo:**
  - Repo root: `C:\Users\Ghwfe\Desktop\personal\kuro-market`. All paths below are relative to it.
  - GitHub repo name `kuro-market`, **public**.
- **API:** `POST https://playkuro.com/api/market/owl-search`, body `{"itemName": "<text>"}`, JSON response `{"success", "data": [listing...]}`.
- **Currency:** only listings with `currency == "PERFECT_PITCH"` count.
- **Rule `"unit"`:** keep `quantityPerBundle == 1 and bundles > 1`.
- **Rule `"stack"`:** keep `quantityPerBundle == 9999`.
- **Default rule for a new item:** `"unit"` if `"hyper"` is in the lowercased name, otherwise `"stack"`.
- **Summaries:**
  - cheapest = min `pricePerBundle`
  - median = `statistics.median` over **distinct `(shopOwner, pricePerBundle)` pairs**
  - also store `listings` (row count) and `stock` (sum of `bundles`)
  - no listings pass → `null`, never 0
- **Store both rules' summaries on every check.**
- **Item matching:** track items by `itemId`. Search results are substring matches, so always filter by exact `itemId`.
- **Schedule:** cron `*/30 * * * *`. History is kept forever.
- **Starter favourites** (`data/favourites.json`):

  | itemId  | itemName               | rule  |
  |---------|------------------------|-------|
  | 4037046 | Dual Blade's Hyper II  | unit  |
  | 4037054 | Phantom's Hyper II     | unit  |
  | 4037032 | Dark Knight's Hyper II | unit  |
  | 4009243 | Mihile's Approval      | stack |
  | 4009245 | Irena's Approval       | stack |
  | 4009246 | Eckhart's Approval     | stack |
  | 4009244 | Oz's Approval          | stack |
  | 4009247 | Hawkeye's Approval     | stack |
  | 4009165 | Dark Fusion Fragment   | stack |

- **Setup** has exactly one manual step: the GitHub browser login. The user never copies a token or edits a file.
- **Local server:** binds `127.0.0.1:8737` only.

## Review Focus

1. **The API fails or returns non-JSON for one item.** That item gets no line for this check; the other items are still recorded and the workflow still commits. Test: `test_run_check_skips_failed_item` (Task 2).
2. **An item has no qualifying listings** (sold out, only troll listings). Record `null`, the chart shows a gap, and the card shows "No listings". Test: `test_summarize_empty_is_none` (Task 1), plus the card's empty state (Task 5).
3. **Names collide as substrings** ("Dual Blade's Hyper I" vs "Hyper II"). Filtering must be by exact `itemId`. Test: `test_filter_ignores_other_item_ids` (Task 1).
4. **The workflow and a dashboard favourite edit push at the same time.** Both sides do `git pull --rebase` before pushing, and the workflow retries 3×. Edits touch different files, so the rebase never conflicts. This is checked manually in Task 6.
5. **The dashboard opens offline or before the first check.** The server serves the local data even if the pull fails, and the page shows "Not synced" and "No data yet" instead of erroring. Test: `test_load_state_without_history` (Task 4).

---

### Task 1: Repo skeleton, filtering rules, summaries

**Files:**
- Create: `tracker/__init__.py` (empty)
- Create: `tracker/rules.py`
- Create: `data/favourites.json`
- Create: `.gitignore` (`__pycache__/`, `.superpowers/`)
- Test: `tests/__init__.py` (empty), `tests/test_rules.py`

**Interfaces:**
- Produces:
  - `Rule = Literal["unit", "stack"]`
  - `default_rule(item_name: str) -> Rule`
  - `filter_listings(listings: list[dict], item_id: int, rule: Rule) -> list[dict]`
  - `summarize(listings: list[dict]) -> dict | None`, returning `{"cheapest": int, "median": float|int, "listings": int, "stock": int}`

- [ ] **Step 1:** `git init` in the repo root. Add `.gitignore` and `data/favourites.json`. The favourites file is a JSON array of `{"itemId", "itemName", "rule"}` objects in the order given in Global Constraints, indent 2.

- [ ] **Step 2: Write failing tests in `tests/test_rules.py`.** Use a helper `L(price, qty, bundles, owner="A", item_id=1, currency="PERFECT_PITCH")` that builds a listing dict.
  - `test_default_rule`:
    - `default_rule("Dark Knight's Hyper II") == "unit"`
    - `default_rule("Oz's Approval") == "stack"`
    - `default_rule("dark fusion fragment") == "stack"`
  - `test_unit_rule_drops_single_stock_and_stacks`:
    - input `[L(13,1,1), L(16,1,338), L(5,9999,1)]`
    - `"unit"` keeps only the price-16 row
  - `test_stack_rule_keeps_only_9999`:
    - input `[L(1000,1,4000), L(2500,9999,1), L(4999,1,9999)]`
    - `"stack"` keeps only the price-2500 row
  - `test_filter_ignores_other_item_ids_and_currencies`:
    - a row with `item_id=2` is dropped
    - a row with `currency="MESO"` is dropped
  - `test_summarize_dedupes_shop_price_pairs`:
    - input: 5× `L(6799,9999,1,"Weak")`, 1× `L(6200,9999,1,"Invell")`, 1× `L(5500,9999,1,"X")`
    - `cheapest == 5500`, `median == 6200` (three distinct pairs), `listings == 7`, `stock == 7`
  - `test_summarize_empty_is_none`: `summarize([]) is None`

- [ ] **Step 3:** Run `python -m unittest tests.test_rules -v`. Expected: FAIL / ImportError.

- [ ] **Step 4:** Implement `tracker/rules.py` to match the Interfaces and Global Constraints.

- [ ] **Step 5:** Run `python -m unittest tests.test_rules -v`. Expected: 6 tests OK.

- [ ] **Step 6:** Commit with the existing `docs/`: `git add -A && git commit -m "feat: filtering rules and summaries"`

---

### Task 2: API client, history store, check runner

**Files:**
- Create: `tracker/api.py`
- Create: `tracker/store.py`
- Create: `tracker/check.py`
- Test: `tests/test_check.py`

**Interfaces:**
- Consumes: `filter_listings` and `summarize` from Task 1.
- Produces:
  - `api.search(item_name: str, timeout: float = 20) -> list[dict]`
    - `urllib.request` POST with a `User-Agent: kuro-market-tracker`
    - retries 2× with a 3 s sleep
    - raises `api.SearchError` on HTTP error, non-JSON, or `success != true`
  - `store.load_favourites(data_dir: Path) -> list[dict]`
  - `store.save_favourites(data_dir: Path, favs: list[dict]) -> None` (indent 2, `ensure_ascii=False`, trailing newline)
  - `store.append_record(data_dir: Path, item_id: int, record: dict) -> None`: appends one compact JSON line to `data/history/<itemId>.jsonl` and creates the directory if needed
  - `store.load_history(data_dir: Path) -> dict[str, list[dict]]`, keyed by itemId string
  - `check.build_record(listings: list[dict], item_id: int, now: datetime) -> dict` returns `{"t": "<UTC ISO, seconds, Z>", "unit": summary|None, "stack": summary|None}`
  - `check.run_check(data_dir: Path, search_fn=api.search, now: datetime | None = None) -> dict[int, dict]`
    - one search per favourite, by its `itemName`
    - appends a record per success and returns the records
    - on `SearchError`, logs `"FAILED <name>: <err>"` to stderr and skips that item
  - `python -m tracker.check` runs it against `Path("data")` and prints one line per item

- [ ] **Step 1: Write failing tests in `tests/test_check.py`.** Use a `tempfile.TemporaryDirectory` data dir with two favourites (one `"unit"`, one `"stack"`) and a fake `search_fn` that returns canned listings.
  - `test_build_record_has_both_rules`: given unit-qualifying and stack-qualifying rows for the same id, both keys are non-null, and `t` ends with `"Z"`.
  - `test_run_check_appends_jsonl`: after two `run_check` calls, each item's `.jsonl` has 2 lines.
  - `test_run_check_skips_failed_item`: the fake raises `SearchError` for item A. Item B still gets a line, and no file is created for A.
  - `test_save_load_favourites_roundtrip_keeps_apostrophes`: `"Dual Blade's Hyper II"` survives the round trip.

- [ ] **Step 2:** Run `python -m unittest tests.test_check -v`. Expected: FAIL.

- [ ] **Step 3:** Implement `api.py`, `store.py`, and `check.py` to match the Interfaces.

- [ ] **Step 4:** Run `python -m unittest discover -s tests -v`. Expected: all OK.

- [ ] **Step 5: Live smoke test.** Run `python -m tracker.check`.
  - Expected: 9 lines with real prices (e.g. a Dark Fusion Fragment stack cheapest around 5,000–7,000), and 9 files in `data/history/`.
  - Delete `data/history/` afterwards so the first committed data comes from GitHub.

- [ ] **Step 6:** `git add -A && git commit -m "feat: price check runner"`

---

### Task 3: Scheduled GitHub workflow

**Files:**
- Create: `.github/workflows/check.yml`

**Interfaces:**
- Consumes: `python -m tracker.check` from Task 2.

- [ ] **Step 1: Write the workflow.**
  - Name `price-check`.
  - Triggers: `schedule: cron "*/30 * * * *"` and `workflow_dispatch`.
  - `permissions: contents: write`.
  - `concurrency: {group: price-check, cancel-in-progress: false}`.
  - Job on `ubuntu-latest`, `timeout-minutes: 10`.
  - Steps:
    1. `actions/checkout@v4`
    2. `actions/setup-python@v5` with `python-version: "3.12"`
    3. `python -m tracker.check`
    4. If `git status --porcelain data` is non-empty:
       - set `user.name "kuro-bot"` / `user.email "41898282+github-actions[bot]@users.noreply.github.com"`
       - commit `data: price check $(date -u +%FT%RZ)`
       - loop 3×: `git pull --rebase && git push && break || sleep 5`

- [ ] **Step 2:** Review the file against the step list above. PyYAML isn't installed, so there's no local linter. Real verification happens in Task 6, when `gh workflow run` executes it.

- [ ] **Step 3:** `git add -A && git commit -m "ci: scheduled price check"`

---

### Task 4: Local dashboard server

**Files:**
- Create: `app/__init__.py` (empty)
- Create: `app/favourites.py`
- Create: `app/gitsync.py`
- Create: `app/server.py`
- Test: `tests/test_app.py`

**Interfaces:**
- Consumes:
  - `store.*` and `api.search` (Task 2)
  - `default_rule`, `filter_listings`, `summarize` (Task 1)
- Produces:
  - `favourites.apply_change(favs: list[dict], change: dict) -> list[dict]`
    - `change` has `action` set to one of `"add" | "remove" | "set_rule"`, plus `itemId: int` and, as needed, `itemName`, `rule`
    - returns a new list
    - adding an existing id is a no-op
    - `add` without `rule` uses `default_rule`
    - raises `ValueError` on an unknown action or rule
  - `gitsync.pull(repo: Path) -> bool`: runs `git pull --rebase --autostash` with a 20 s timeout and returns success
  - `gitsync.commit_and_push(repo: Path, paths: list[str], message: str) -> bool`: add, commit, then pull --rebase, then push; returns whether the push succeeded
  - `server.load_state(repo: Path, synced: bool) -> dict` returns `{"favourites": [...], "history": {...}, "synced": bool}`
  - `server.search_payload(query: str, search_fn=api.search) -> list[dict]`
    - groups results by `itemId`
    - each entry: `{"itemId", "itemName", "defaultRule", "unit": summary|None, "stack": summary|None, "listings": [rows filtered by default rule, sorted by price]}`
- **HTTP** (`ThreadingHTTPServer` on `127.0.0.1:8737`):
  - `GET /` and static files from `app/static/`
  - `GET /api/state` pulls first, then calls `load_state`
  - `GET /api/search?q=` (URL-decoded) calls `search_payload`. On `SearchError` it returns 502 `{"error": msg}`.
  - `POST /api/favourites` with a JSON change does: `apply_change` → `save_favourites` → `commit_and_push(["data/favourites.json"], "favourites: <action> <itemName or id>")`. It returns `{"favourites", "pushed"}`, or 400 on `ValueError`.
  - `main()`:
    - if the port is already in use, just `webbrowser.open("http://127.0.0.1:8737")` and exit
    - otherwise start the server, then open the browser

- [ ] **Step 1: Write failing tests in `tests/test_app.py`.**
  - `test_add_uses_default_rule`
  - `test_add_existing_is_noop`
  - `test_remove`
  - `test_set_rule`
  - `test_bad_action_raises`
  - `test_search_payload_groups_by_item_id`: a fake search returns Hyper I and Hyper II rows, giving 2 entries, each `listings` holds only its own id, and `defaultRule == "unit"`
  - `test_load_state_without_history`: a temp repo containing only `data/favourites.json` gives `history == {}` and `synced is False` when passed `False`

- [ ] **Step 2:** Run `python -m unittest tests.test_app -v`. Expected: FAIL.

- [ ] **Step 3:** Implement `favourites.py`, `gitsync.py`, and `server.py`. Run `git` via `subprocess.run` with `cwd=repo`, `capture_output`, and `timeout`. Any exception counts as `False`.

- [ ] **Step 4:** Run `python -m unittest discover -s tests -v`. Expected: all OK.

- [ ] **Step 5:** `git add -A && git commit -m "feat: local dashboard server"`

---

### Task 5: Dashboard page (card grid)

**Files:**
- Create: `app/static/index.html`
- Create: `app/static/app.js`
- Create: `app/static/style.css`

**Interfaces:**
- Consumes: the HTTP API from Task 4.
- Chart.js: `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`. Use time on a linear x-axis in epoch ms with formatted tick labels, so no date adapter is needed.

- [ ] **Step 1: Build the page to match the approved layout A.**
  - **Header:** title "Kuro Market" and a sync badge ("Synced" / "Not synced").
  - **Search box** (Enter to search). Results list one row per item: name, rule label, cheapest and median under the default rule, an expandable listings table (seller, channel, price, stock), and **Add to favourites** (or "★ Tracked" if it's already a favourite).
  - **Card grid**, one card per favourite:
    - name and rule label ("9999 stack" / "per unit")
    - latest cheapest (large) and median (small), under the item's own rule
    - % change of cheapest vs the closest record ≥24 h older (omitted if none). Down is green, up is red.
    - a 7-day mini chart: cheapest solid, median dashed
    - empty states: "No data yet" (no records) and "No listings" (latest is null)
  - **Detail view** (clicking a card opens a modal):
    - a full chart with buttons 24h / 7d / 30d / All
    - live current listings, fetched via `/api/search?q=<itemName>` and filtered to the item's id and rule
    - a rule toggle (`set_rule`) and a **Remove** button
  - **Formatting:** numbers via `toLocaleString()`. Null points render as gaps (`spanGaps: false`).
  - **Theme:** light and dark via `prefers-color-scheme`. Layout works down to 375 px wide.
  - **After any favourites change:** re-fetch `/api/state`. If `pushed` is false, show a toast: "Saved locally — couldn't reach GitHub, will sync next time."

- [ ] **Step 2: Verify.**
  - Run `python -m tracker.check` twice, a minute apart, to get local data. Then run `python -m app.server` and open the page in the browser pane.
  - Expected: 9 cards with numbers and mini charts. Searching "Hyper II" lists many classes. Adding then removing one works (pushed=false is expected before setup). The modal opens and its range buttons change the chart.
  - Check at 375 px width and in dark mode.
  - Afterwards, delete the local `data/history/` and revert the favourites changes (`git checkout data/favourites.json`).

- [ ] **Step 3:** `git add -A && git commit -m "feat: card grid dashboard"`

---

### Task 6: One-step setup, launcher, end-to-end check

**Files:**
- Create: `setup.bat` (runs `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"` then `pause`)
- Create: `setup.ps1`
- Create: `start.bat` (`cd /d "%~dp0"` then `start "" pythonw -m app.server`)
- Create: `README.md`: what it is, how to double-click `setup.bat`, and how to use the desktop shortcut. Keep it short.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `setup.ps1`.** It must be idempotent (safe to re-run) and print a clear `[n/6]` line per step.
  1. **Check prerequisites.** Confirm `git` and `python` are available. If not, print what to install and exit.
  2. **Install the GitHub CLI if needed.** If `gh` is missing, run `winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements`. Then use `"$env:ProgramFiles\GitHub CLI\gh.exe"` directly, since PATH isn't refreshed in this session.
  3. **Log in.** If `gh auth status` fails, run `gh auth login --web --git-protocol https --hostname github.com`, which is the only manual step. Then run `gh auth setup-git`.
  4. **Initialise the repo.**
     - If `git config user.email` is empty, set it locally from `gh api user --jq .login` as `<login>@users.noreply.github.com`, and set user.name to the login.
     - Make sure there's at least one commit.
     - If there's no `origin` remote, run `gh repo create kuro-market --public --source . --remote origin --push`. Otherwise run `git push -u origin HEAD`.
  5. **Start the schedule.** Run `gh workflow enable price-check` (ignore errors) and `gh workflow run price-check`.
  6. **Create the desktop shortcut.** Use `WScript.Shell` to create a "Kuro Market" shortcut on `[Environment]::GetFolderPath('Desktop')` that targets `start.bat`, with WorkingDirectory set to the repo root and WindowStyle 7 (minimised).

  Finish by printing "Done — open 'Kuro Market' on your desktop."

- [ ] **Step 2: Run setup end to end with the user.** The user double-clicks `setup.bat` and completes the browser login.
  - Expected: the repo `github.com/<login>/kuro-market` exists and is public.
  - `gh run list --workflow price-check` shows a run that completes successfully within a few minutes, and `data/history/*.jsonl` (9 files) appears in the repo.
  - If the run fails with 403 or a Cloudflare challenge, stop and report it. The spec's Task Scheduler fallback then becomes a new task.

- [ ] **Step 3: Verify the dashboard end to end.** Double-click the desktop shortcut.
  - Expected: the browser opens on the dashboard, the badge shows "Synced", and 9 cards show the GitHub-recorded data.
  - Add a favourite from search. Expected: `pushed: true`, and the commit is visible on GitHub.
  - Run `gh workflow run price-check` right after. Expected: it succeeds, which proves the concurrent-push path. The next scheduled check then includes the new item.

- [ ] **Step 4:** `git add -A && git commit -m "feat: one-step setup and launcher" && git push`
