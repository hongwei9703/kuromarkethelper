"""Which market listings count, and how they're summarised."""
import statistics
from typing import Literal

Rule = Literal["unit", "stack"]
RULES: tuple[Rule, ...] = ("unit", "stack")
CURRENCY = "PERFECT_PITCH"
STACK_SIZE = 9999


def default_rule(item_name: str) -> Rule:
    return "unit" if "hyper" in item_name.lower() else "stack"


def _keep(listing: dict, rule: Rule) -> bool:
    qty = listing.get("quantityPerBundle")
    if rule == "unit":
        return qty == 1 and (listing.get("bundles") or 0) > 1
    return qty == STACK_SIZE


def filter_listings(listings: list[dict], item_id: int, rule: Rule) -> list[dict]:
    return [
        x for x in listings
        if x.get("itemId") == item_id and x.get("currency") == CURRENCY and _keep(x, rule)
    ]


def summarize(listings: list[dict]) -> dict | None:
    if not listings:
        return None
    prices = [x["pricePerBundle"] for x in listings]
    distinct = {(x.get("shopOwner"), x["pricePerBundle"]) for x in listings}
    return {
        "cheapest": min(prices),
        "median": statistics.median(p for _, p in distinct),
        "listings": len(listings),
        "stock": sum(x.get("bundles") or 0 for x in listings),
    }
