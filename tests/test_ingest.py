import unittest
import tempfile
import os
import subprocess
import textwrap

class IngestTests(unittest.TestCase):
    def setUp(self):
        # locate repo root (parent of tests folder)
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ingest_file_script = os.path.join(self.repo_root, "ingest_file.py")
        self.ingest_all_script = os.path.join(self.repo_root, "ingest_all_seasons.py")

    def write_csv(self, dirpath, filename, content):
        path = os.path.join(dirpath, filename)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return path

    def test_verification_dry_run(self):
        content = textwrap.dedent("""
            Shirts,,,,,,,,,,Skins,,,,,,,,,,
            Alice,1,1,2,10,20,2,1,1,,Bob,2,1,2,12,24,2,0,,,,,
            Charlie,0,0,3,5,7,1,0,0,,Dave,0,0,3,4,8,1,1,,,,,
        """)
        with tempfile.TemporaryDirectory() as td:
            csv_path = self.write_csv(td, "SeasonTest Regular Season.csv", content)
            # run script
            proc = subprocess.run(["python3", self.ingest_file_script, csv_path], capture_output=True, text=True)
            out = proc.stdout
            err = proc.stderr
            # should have printed player header and stats
            self.assertIn('Player', out, msg=f"stdout:\n{out}\nstderr:\n{err}")
            self.assertIn('Alice', out)

    def test_all_seasons_upload_flag(self):
        content = textwrap.dedent("""
            Shirts,,,,,,,,,,Skins,,,,,,,,,,
            Alice,1,1,2,10,20,2,1,1,,Bob,2,1,2,12,24,2,0,,,,,
            Charlie,0,0,3,5,7,1,0,0,,Dave,0,0,3,4,8,1,1,,,,,
        """)
        with tempfile.TemporaryDirectory() as td:
            # create two CSVs
            self.write_csv(td, "S1 Regular Season.csv", content)
            self.write_csv(td, "S2 Regular Season.csv", content)
            # run ingest_all_seasons.py with --upload in the temp dir
            proc = subprocess.run(["python3", self.ingest_all_script, "--pattern", "*Regular Season*.csv", "--upload"], cwd=td, capture_output=True, text=True)
            out = proc.stdout
            err = proc.stderr
            # should indicate stub upload
            self.assertIn('STUB UPLOAD', out)
            self.assertIn('season', out)

if __name__ == '__main__':
    unittest.main()
