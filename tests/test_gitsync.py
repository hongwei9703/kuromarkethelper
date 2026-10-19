import subprocess
import tempfile
import unittest
from pathlib import Path

from app import gitsync


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class GitSyncTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.remote = root / "remote.git"
        git(root, "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.a = self._clone(root / "a")
        (self.a / "f.txt").write_text("base\n")
        git(self.a, "add", "-A")
        git(self.a, "commit", "-qm", "base")
        git(self.a, "push", "-q", "-u", "origin", "main")
        self.b = self._clone(root / "b")

    def _clone(self, path):
        git(path.parent, "clone", "-q", str(self.remote), str(path))
        git(path, "config", "user.name", "t")
        git(path, "config", "user.email", "t@example.com")
        return path

    def tearDown(self):
        self._tmp.cleanup()

    def remote_log(self):
        out = subprocess.run(["git", "--git-dir", str(self.remote), "log", "--format=%s", "main"], capture_output=True, text=True)
        return out.stdout.split()

    def test_sync_pushes_pending_commit(self):
        (self.b / "g.txt").write_text("x\n")
        git(self.b, "add", "-A")
        git(self.b, "commit", "-qm", "pending")
        self.assertTrue(gitsync.sync(self.b))
        self.assertIn("pending", self.remote_log())

    def test_failed_rebase_is_aborted(self):
        (self.a / "f.txt").write_text("from a\n")
        git(self.a, "commit", "-qam", "a-change")
        git(self.a, "push", "-q")
        (self.b / "f.txt").write_text("from b\n")
        git(self.b, "commit", "-qam", "b-change")
        self.assertFalse(gitsync.pull(self.b))
        self.assertFalse((self.b / ".git" / "rebase-merge").exists())
        self.assertFalse((self.b / ".git" / "rebase-apply").exists())


if __name__ == "__main__":
    unittest.main()
