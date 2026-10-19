"""Favourites list and per-item price history on disk."""
import json
from pathlib import Path


def load_favourites(data_dir: Path) -> list[dict]:
    path = Path(data_dir) / "favourites.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def save_favourites(data_dir: Path, favs: list[dict]) -> None:
    path = Path(data_dir) / "favourites.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(favs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def append_record(data_dir: Path, item_id: int, record: dict) -> None:
    folder = Path(data_dir) / "history"
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / f"{item_id}.jsonl", "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(record, separators=(",", ":")) + "\n")


def load_history(data_dir: Path) -> dict[str, list[dict]]:
    folder = Path(data_dir) / "history"
    history: dict[str, list[dict]] = {}
    if not folder.is_dir():
        return history
    for path in sorted(folder.glob("*.jsonl")):
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
        history[path.stem] = rows
    return history
