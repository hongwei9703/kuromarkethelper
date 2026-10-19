import unittest

from tracker.rules import default_rule, filter_listings, summarize


def L(price, qty, bundles, owner="A", item_id=1, currency="PERFECT_PITCH"):
    return {
        "itemId": item_id,
        "itemName": "X",
        "bundles": bundles,
        "price": price,
        "pricePerBundle": price,
        "currency": currency,
        "quantityPerBundle": qty,
        "shopOwner": owner,
        "shopType": "hired",
        "mapId": 910000000,
        "channel": 1,
    }


class RulesTest(unittest.TestCase):
    def test_default_rule(self):
        self.assertEqual(default_rule("Dark Knight's Hyper II"), "unit")
        self.assertEqual(default_rule("Oz's Approval"), "stack")
        self.assertEqual(default_rule("dark fusion fragment"), "stack")

    def test_default_rule_equipment_by_item_id(self):
        self.assertEqual(default_rule("Shark Tooth Skipper Boots", 1072489), "equip")
        self.assertEqual(default_rule("Chaos Zakum Helmet", 1003112), "equip")
        self.assertEqual(default_rule("Dark Knight's Hyper II", 4037032), "unit")
        self.assertEqual(default_rule("Oz's Approval", 4009244), "stack")

    def test_equip_rule_keeps_every_single_item_listing(self):
        rows = [L(40000, 1, 1), L(10000, 1, 1), L(5, 9999, 1)]
        kept = filter_listings(rows, 1, "equip")
        self.assertEqual([r["pricePerBundle"] for r in kept], [40000, 10000])

    def test_unit_rule_drops_single_stock_and_stacks(self):
        rows = [L(13, 1, 1), L(16, 1, 338), L(5, 9999, 1)]
        kept = filter_listings(rows, 1, "unit")
        self.assertEqual([r["pricePerBundle"] for r in kept], [16])

    def test_stack_rule_keeps_only_9999(self):
        rows = [L(1000, 1, 4000), L(2500, 9999, 1), L(4999, 1, 9999)]
        kept = filter_listings(rows, 1, "stack")
        self.assertEqual([r["pricePerBundle"] for r in kept], [2500])

    def test_filter_ignores_other_item_ids_and_currencies(self):
        rows = [L(2500, 9999, 1), L(2400, 9999, 1, item_id=2), L(2300, 9999, 1, currency="MESO")]
        kept = filter_listings(rows, 1, "stack")
        self.assertEqual([r["pricePerBundle"] for r in kept], [2500])

    def test_summarize_dedupes_shop_price_pairs(self):
        rows = [L(6799, 9999, 1, "Weak")] * 5 + [L(6200, 9999, 1, "Invell"), L(5500, 9999, 1, "X")]
        s = summarize(rows)
        self.assertEqual(s, {"cheapest": 5500, "median": 6200, "listings": 7, "stock": 7})

    def test_summarize_empty_is_none(self):
        self.assertIsNone(summarize([]))


if __name__ == "__main__":
    unittest.main()
