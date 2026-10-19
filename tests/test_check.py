import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from tracker import store
from tracker.api import SearchError
from tracker.check import build_record, run_check
from tests.test_rules import L

NOW = datetime(2026, 10, 19, 2, 0, tzinfo=timezone.utc)
FAVS = [
    {"itemId": 1, "itemName": "A Hyper II", "rule": "unit"},
    {"itemId": 2, "itemName": "B Approval", "rule": "stack"},
]


def canned(name):
    if name == "A Hyper II":
        return [L(15, 1, 300, item_id=1), L(13, 1, 1, item_id=1)]
    return [L(2500, 9999, 1, item_id=2), L(1000, 1, 4000, item_id=2)]


class CheckTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.data = Path(self._tmp.name)
        store.save_favourites(self.data, FAVS)

    def tearDown(self):
        self._tmp.cleanup()

    def lines(self, item_id):
        p = self.data / "history" / f"{item_id}.jsonl"
        return p.read_text(encoding="utf-8").splitlines() if p.exists() else None

    def test_build_record_has_both_rules(self):
        rows = [L(15, 1, 300), L(2500, 9999, 1)]
        rec = build_record(rows, 1, NOW)
        self.assertEqual(rec["unit"]["cheapest"], 15)
        self.assertEqual(rec["stack"]["cheapest"], 2500)
        self.assertEqual(rec["t"], "2026-10-19T02:00:00Z")

    def test_run_check_appends_jsonl(self):
        run_check(self.data, search_fn=canned, now=NOW)
        run_check(self.data, search_fn=canned, now=NOW)
        self.assertEqual(len(self.lines(1)), 2)
        self.assertEqual(len(self.lines(2)), 2)
        self.assertEqual(json.loads(self.lines(2)[0])["stack"]["cheapest"], 2500)

    def test_run_check_skips_failed_item(self):
        def flaky(name):
            if name == "A Hyper II":
                raise SearchError("boom")
            return canned(name)

        records = run_check(self.data, search_fn=flaky, now=NOW)
        self.assertIsNone(self.lines(1))
        self.assertEqual(len(self.lines(2)), 1)
        self.assertEqual(list(records), [2])

    def test_save_load_favourites_roundtrip_keeps_apostrophes(self):
        favs = [{"itemId": 4037046, "itemName": "Dual Blade's Hyper II", "rule": "unit"}]
        store.save_favourites(self.data, favs)
        self.assertEqual(store.load_favourites(self.data), favs)
        self.assertIn("Dual Blade's", (self.data / "favourites.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
