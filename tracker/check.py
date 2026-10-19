"""One price check: search every favourite and append a history record."""
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from tracker import api, store
from tracker.rules import RULES, filter_listings, summarize


def build_record(listings: list[dict], item_id: int, now: datetime) -> dict:
    record = {"t": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    for rule in RULES:
        record[rule] = summarize(filter_listings(listings, item_id, rule))
    return record


BUDGET_S = 480  # stay well inside the workflow's timeout so finished items still get committed


def run_check(data_dir: Path, search_fn=api.search, now: datetime | None = None,
              budget_s: float = BUDGET_S, clock=time.monotonic) -> dict[int, dict]:
    now = now or datetime.now(timezone.utc)
    records: dict[int, dict] = {}
    start = clock()
    for fav in store.load_favourites(data_dir):
        if clock() - start > budget_s:
            print(f"SKIPPED {fav['itemName']} and the rest: out of time", file=sys.stderr)
            break
        try:
            record = build_record(search_fn(fav["itemName"]), fav["itemId"], now)
        except Exception as e:  # one bad item must never lose the others
            print(f"FAILED {fav['itemName']}: {e!r}", file=sys.stderr)
            continue
        store.append_record(data_dir, fav["itemId"], record)
        records[fav["itemId"]] = record
    return records


def main() -> None:
    favs = {f["itemId"]: f for f in store.load_favourites(Path("data"))}
    for item_id, rec in run_check(Path("data")).items():
        fav = favs[item_id]
        s = rec[fav["rule"]]
        shown = f"cheapest {s['cheapest']} median {s['median']} ({s['listings']} listings)" if s else "no listings"
        print(f"{fav['itemName']} [{fav['rule']}]: {shown}")


if __name__ == "__main__":
    main()
