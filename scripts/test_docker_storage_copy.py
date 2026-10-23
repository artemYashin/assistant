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

    def test_metadata_mismatch_is_reported_separately_from_data(self):
        original = {'.': (16384, 448, 1000, 1000, None), 'private-name': (32768, 384, 1000, 1000, (8, 'hash'))}
        changed = {'.': (16384, 493, 501, 20, None), 'private-name': (32768, 384, 501, 20, (8, 'hash'))}
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(copy, 'inventory', side_effect=[original, changed]):
                with self.assertRaises(copy.StorageCopyError) as result:
                    copy.verify_copy(Path(tmp), Path(tmp))
        message = copy.safe_error(result.exception)
        self.assertIn('METADATA_MISMATCH', message)
        self.assertIn('uid=2', message)
        self.assertIn('root_uid=1', message)
        self.assertIn('contents and symlink targets match', message)
        self.assertNotIn('private-name', message)

    def test_missing_entries_are_not_mistaken_for_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(copy, 'inventory', side_effect=[{'private-name': (32768, 384, 1, 1, (8, 'hash'))}, {}]):
                with self.assertRaisesRegex(copy.StorageCopyError, 'DATA_MISMATCH: missing_entries=1'):
                    copy.verify_copy(Path(tmp), Path(tmp))

    def test_verify_does_not_copy_or_change_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'target'
            source.mkdir()
            (source / 'file').write_bytes(b'content')
            copy.copy_verified(source, target)
            with patch.object(copy.subprocess, 'run', side_effect=AssertionError('Must not copy')):
                copy.verify_copy(source, target)

    def test_filesystem_errors_hide_sensitive_paths(self):
        message = copy.safe_error(PermissionError(13, 'Denied', '/private-key-path'))
        self.assertIn('EACCES', message)
        self.assertNotIn('private-key-path', message)

if __name__ == '__main__':
    unittest.main()
