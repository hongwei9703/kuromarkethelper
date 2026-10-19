"""Keep the local checkout in sync with GitHub (auth comes from the GitHub CLI)."""
import subprocess
from pathlib import Path

TIMEOUT = 20


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
    return _git(repo, "pull", "--rebase", "--autostash")


def commit_and_push(repo: Path, paths: list[str], message: str) -> bool:
    if not _git(repo, "add", *paths):
        return False
    _git(repo, "commit", "-m", message)  # fails harmlessly when nothing changed
    return pull(repo) and _git(repo, "push")
