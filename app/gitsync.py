"""Keep the local checkout in sync with GitHub (auth comes from the GitHub CLI)."""
import subprocess
import threading
from pathlib import Path

TIMEOUT = 20
LOCK = threading.RLock()  # one git operation at a time; the server is threaded


def _git(repo: Path, *args: str) -> bool:
    try:
        result = subprocess.run(
            ["git", *args], cwd=repo, capture_output=True, timeout=TIMEOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return result.returncode == 0
    except Exception:
        return False


def pull(repo: Path) -> bool:
    with LOCK:
        if _git(repo, "pull", "--rebase", "--autostash"):
            return True
        _git(repo, "rebase", "--abort")  # never leave the checkout stuck mid-rebase
        return False


def sync(repo: Path) -> bool:
    """Pull the latest data and push any local commits a previous attempt couldn't."""
    with LOCK:
        return pull(repo) and _git(repo, "push")


def commit_and_push(repo: Path, paths: list[str], message: str) -> bool:
    with LOCK:
        if not _git(repo, "add", *paths):
            return False
        _git(repo, "commit", "-m", message)  # fails harmlessly when nothing changed
        return sync(repo)
