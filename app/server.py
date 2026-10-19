"""Local dashboard server: serves the page and talks to GitHub and the market API."""
import json
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
        rule = default_rule(name)
        entry = {"itemId": item_id, "itemName": name, "defaultRule": rule}
        for r in RULES:
            entry[r] = summarize(filter_listings(rows, item_id, r))
        entry["listings"] = sorted(filter_listings(rows, item_id, rule), key=lambda x: x["pricePerBundle"])
        out.append(entry)
    return sorted(out, key=lambda e: e["itemName"])


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
            return self._json(200, load_state(REPO, gitsync.pull(REPO)))
        if url.path == "/api/search":
            query = (parse_qs(url.query).get("q") or [""])[0].strip()
            if not query:
                return self._json(400, {"error": "empty search"})
            try:
                return self._json(200, search_payload(query))
            except api.SearchError as e:
                return self._json(502, {"error": str(e)})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/favourites":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            change = json.loads(self.rfile.read(length) or b"{}")
            data = REPO / "data"
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
    url = f"http://{HOST}:{PORT}"
    if _port_in_use():
        webbrowser.open(url)
        return
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Kuro Market dashboard on {url}", file=sys.stderr)
    webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
