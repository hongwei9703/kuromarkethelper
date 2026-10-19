"""Local dashboard server: serves the page and talks to GitHub and the market API."""
import json
import os
import socket
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app import gitsync
from app.favourites import apply_change
from tracker import api, store
from tracker.rules import RULES, default_rule, filter_listings, summarize

HOST, PORT = "127.0.0.1", 8737
REPO = Path(__file__).resolve().parent.parent
STATIC = Path(__file__).resolve().parent / "static"


def load_state(repo: Path, synced: bool) -> dict:
    data = Path(repo) / "data"
    return {
        "favourites": store.load_favourites(data),
        "history": store.load_history(data),
        "synced": synced,
    }


def search_payload(query: str, search_fn=api.search) -> list[dict]:
    rows = search_fn(query)
    names: dict[int, str] = {}
    for row in rows:
        names.setdefault(row.get("itemId"), row.get("itemName", ""))
    out = []
    for item_id, name in names.items():
        if item_id is None:
            continue
        rule = default_rule(name, item_id)
        entry = {"itemId": item_id, "itemName": name, "defaultRule": rule}
        for r in RULES:
            entry[r] = summarize(filter_listings(rows, item_id, r))
        entry["listings"] = sorted(filter_listings(rows, item_id, rule), key=lambda x: x["pricePerBundle"])
        out.append(entry)
    return sorted(out, key=lambda e: e["itemName"])


def listings_payload(query: str, item_id: int, rule: str, search_fn=api.search) -> list[dict]:
    if rule not in RULES:
        raise ValueError(f"unknown rule: {rule}")
    rows = filter_listings(search_fn(query), item_id, rule)
    return sorted(rows, key=lambda x: x["pricePerBundle"])


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, *args):
        pass

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/state":
            return self._json(200, load_state(REPO, gitsync.sync(REPO)))
        if url.path == "/api/search":
            query = (parse_qs(url.query).get("q") or [""])[0].strip()
            if not query:
                return self._json(400, {"error": "empty search"})
            try:
                return self._json(200, search_payload(query))
            except api.SearchError as e:
                return self._json(502, {"error": str(e)})
        if url.path == "/api/listings":
            params = parse_qs(url.query)
            try:
                item_id = int((params.get("itemId") or [""])[0])
                rule = (params.get("rule") or [""])[0]
                query = (params.get("q") or [""])[0].strip()
                return self._json(200, listings_payload(query, item_id, rule))
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            except api.SearchError as e:
                return self._json(502, {"error": str(e)})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/favourites":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            change = json.loads(self.rfile.read(length) or b"{}")
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        data = REPO / "data"
        with gitsync.LOCK:
            try:
                favs = apply_change(store.load_favourites(data), change)
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            store.save_favourites(data, favs)
            label = change.get("itemName") or change.get("itemId")
            pushed = gitsync.commit_and_push(REPO, ["data/favourites.json"], f"favourites: {change['action']} {label}")
        self._json(200, {"favourites": favs, "pushed": pushed})


def _port_in_use() -> bool:
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) == 0


def main() -> None:
    if sys.stderr is None:  # started with pythonw: no console to write errors to
        sys.stderr = open(os.devnull, "w")
    url = f"http://{HOST}:{PORT}"
    open_browser = "--no-browser" not in sys.argv
    if _port_in_use():
        if open_browser:
            webbrowser.open(url)
        return
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Kuro Market dashboard on {url}", file=sys.stderr)
    if open_browser:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
