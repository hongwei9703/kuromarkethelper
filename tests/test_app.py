import tempfile
import unittest
from pathlib import Path

from app.favourites import apply_change
from app.server import listings_payload, load_state, search_payload
from tests.test_rules import L
from tracker import store

FAVS = [{"itemId": 1, "itemName": "Oz's Approval", "rule": "stack"}]


class FavouritesTest(unittest.TestCase):
    def test_add_uses_default_rule(self):
        out = apply_change(FAVS, {"action": "add", "itemId": 2, "itemName": "Phantom's Hyper II"})
        self.assertEqual(out[-1], {"itemId": 2, "itemName": "Phantom's Hyper II", "rule": "unit"})
        self.assertEqual(len(FAVS), 1)

    def test_add_existing_is_noop(self):
        out = apply_change(FAVS, {"action": "add", "itemId": 1, "itemName": "Oz's Approval"})
        self.assertEqual(out, FAVS)

    def test_remove(self):
        self.assertEqual(apply_change(FAVS, {"action": "remove", "itemId": 1}), [])

    def test_set_rule(self):
        out = apply_change(FAVS, {"action": "set_rule", "itemId": 1, "rule": "unit"})
        self.assertEqual(out[0]["rule"], "unit")

    def test_bad_action_raises(self):
        with self.assertRaises(ValueError):
            apply_change(FAVS, {"action": "explode", "itemId": 1})
        with self.assertRaises(ValueError):
            apply_change(FAVS, {"action": "set_rule", "itemId": 1, "rule": "bogus"})


class ServerTest(unittest.TestCase):
    def test_search_payload_groups_by_item_id(self):
        rows = [
            {**L(15, 1, 300, item_id=10), "itemName": "Dual Blade's Hyper II"},
            {**L(12, 1, 200, item_id=10), "itemName": "Dual Blade's Hyper II"},
            {**L(5, 1, 100, item_id=11), "itemName": "Dual Blade's Hyper I"},
        ]
        out = search_payload("Dual Blade", search_fn=lambda q: rows)
        self.assertEqual(len(out), 2)
        by_id = {e["itemId"]: e for e in out}
        self.assertEqual(by_id[10]["defaultRule"], "unit")
        self.assertEqual([r["pricePerBundle"] for r in by_id[10]["listings"]], [12, 15])
        self.assertTrue(all(r["itemId"] == 11 for r in by_id[11]["listings"]))
        self.assertEqual(by_id[10]["unit"]["cheapest"], 12)

    def test_listings_payload_uses_given_rule(self):
        rows = [L(2500, 9999, 1, item_id=5), L(900, 1, 4000, item_id=5), L(2400, 9999, 1, item_id=6)]
        out = listings_payload("Approval", 5, "stack", search_fn=lambda q: rows)
        self.assertEqual([r["pricePerBundle"] for r in out], [2500])
        out = listings_payload("Approval", 5, "unit", search_fn=lambda q: rows)
        self.assertEqual([r["pricePerBundle"] for r in out], [900])
        with self.assertRaises(ValueError):
            listings_payload("Approval", 5, "bogus", search_fn=lambda q: rows)

    def test_load_state_without_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            store.save_favourites(repo / "data", FAVS)
            state = load_state(repo, synced=False)
            self.assertEqual(state, {"favourites": FAVS, "history": {}, "synced": False})


if __name__ == "__main__":
    unittest.main()
