"""Pure edits to the favourites list."""
from tracker.rules import RULES, default_rule


def apply_change(favs: list[dict], change: dict) -> list[dict]:
    action = change.get("action")
    try:
        item_id = int(change.get("itemId"))
    except (TypeError, ValueError):
        raise ValueError("itemId is required")
    out = [dict(f) for f in favs]

    if action == "add":
        if any(f["itemId"] == item_id for f in out):
            return out
        name = (change.get("itemName") or "").strip()
        if not name:
            raise ValueError("itemName is required")
        rule = change.get("rule") or default_rule(name)
        if rule not in RULES:
            raise ValueError(f"unknown rule: {rule}")
        return out + [{"itemId": item_id, "itemName": name, "rule": rule}]

    if action == "remove":
        return [f for f in out if f["itemId"] != item_id]

    if action == "set_rule":
        rule = change.get("rule")
        if rule not in RULES:
            raise ValueError(f"unknown rule: {rule}")
        for f in out:
            if f["itemId"] == item_id:
                f["rule"] = rule
        return out

    raise ValueError(f"unknown action: {action}")
