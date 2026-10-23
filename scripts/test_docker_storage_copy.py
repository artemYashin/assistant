import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('storage_copy', Path(__file__).with_name('docker-storage-copy.py'))
copy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copy)

class StorageCopyTests(unittest.TestCase):
    def test_full_copy_retains_keys_modes_hidden_files_and_model_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir(mode=0o700)
            (source / 'master.key').write_bytes(b'test-only-key')
            (source / 'master.key').chmod(0o600)
            (source / '.hidden').write_bytes(b'bytes\x00\xff')
            (source / 'models').mkdir()
            (source / 'models' / 'blob').write_bytes(b'fake model')
            (source / 'models' / 'reference').symlink_to('blob')
            (source / 'models' / 'dangling').symlink_to('missing')
            before = copy.inventory(source)
            destination = root / 'destination'
            copy.copy_verified(source, destination)
            self.assertEqual(before, copy.inventory(destination))
            self.assertEqual(before, copy.inventory(source))
            with self.assertRaises(RuntimeError):
                copy.copy_verified(source, destination)
            self.assertEqual(before, copy.inventory(destination))

    def test_corruption_is_detected_without_altering_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source'
            source.mkdir()
            (source / 'db').write_bytes(b'database')
            destination = Path(tmp) / 'destination'
            run = copy.subprocess.run
            def corrupt(*args, **kwargs):
                run(*args, **kwargs)
                (destination / 'db').write_bytes(b'corrupted')
            with patch.object(copy.subprocess, 'run', corrupt):
                with self.assertRaises(RuntimeError):
                    copy.copy_verified(source, destination)
            self.assertEqual((source / 'db').read_bytes(), b'database')

if __name__ == '__main__':
    unittest.main()
