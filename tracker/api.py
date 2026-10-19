"""Client for the Kuro market search API."""
import json
import time
import urllib.error
import urllib.request

URL = "https://playkuro.com/api/market/owl-search"
RETRIES = 2
RETRY_SLEEP = 3


class SearchError(Exception):
    pass


def _once(item_name: str, timeout: float) -> list[dict]:
    req = urllib.request.Request(
        URL,
        data=json.dumps({"itemName": item_name}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "kuro-market-tracker"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise SearchError(str(e)) from e
    if not isinstance(body, dict) or body.get("success") is not True:
        msg = body.get("msg") if isinstance(body, dict) else None
        raise SearchError(msg or "unexpected response")
    return body.get("data") or []


def search(item_name: str, timeout: float = 20) -> list[dict]:
    for attempt in range(RETRIES + 1):
        try:
            return _once(item_name, timeout)
        except SearchError:
            if attempt == RETRIES:
                raise
            time.sleep(RETRY_SLEEP)
    return []
