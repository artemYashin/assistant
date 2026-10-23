import importlib.util
import os
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

    def test_preparation_resumes_copy_and_checks_real_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'target'
            source.mkdir(mode=0o700)
            (source / 'master.key').write_bytes(b'test key')
            (source / 'master.key').chmod(0o600)
            copy.copy_verified(source, target)
            before = copy.inventory(source)
            (target / 'master.key').chmod(0o644)
            with patch.object(copy.subprocess, 'run', side_effect=AssertionError('Existing copy must not be recopied')):
                copy.prepare_copy(source, target, os.getuid())
            self.assertEqual((target / 'master.key').stat().st_mode & 0o777, 0o600)
            copy.check_service_access(target)
            self.assertEqual(before, copy.inventory(source))
            self.assertEqual(set(copy.inventory(target)), set(before))

    def test_prepare_does_not_change_permissions_when_data_differs(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'target'
            source.mkdir()
            (source / 'file').write_bytes(b'original')
            copy.copy_verified(source, target)
            (target / 'file').write_bytes(b'wrong')
            with patch.object(copy.os, 'chown', side_effect=AssertionError('Must verify content first')):
                with self.assertRaisesRegex(copy.StorageCopyError, 'DATA_MISMATCH'):
                    copy.prepare_copy(source, target, os.getuid())
            self.assertEqual((source / 'file').read_bytes(), b'original')

    def test_service_access_failure_stops_migration(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(copy.os, 'access', return_value=False):
                with self.assertRaisesRegex(copy.StorageCopyError, 'SERVICE_ACCESS_DENIED'):
                    copy.check_service_access(Path(tmp))

    def test_data_verification_accepts_host_ownership_mapping_but_rejects_content_changes(self):
        original = {'.': (16384, 448, 1000, 1000, None), 'file': (32768, 384, 1000, 1000, (8, 'hash'))}
        mapped = {'.': (16384, 448, 501, 20, None), 'file': (32768, 384, 501, 20, (8, 'hash'))}
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(copy, 'inventory', side_effect=[original, mapped]):
                copy.verify_copy(Path(tmp), Path(tmp), require_metadata=False)
            mapped['file'] = (32768, 384, 501, 20, (8, 'different'))
            with patch.object(copy, 'inventory', side_effect=[original, mapped]):
                with self.assertRaisesRegex(copy.StorageCopyError, 'DATA_MISMATCH'):
                    copy.verify_copy(Path(tmp), Path(tmp), require_metadata=False)


    def test_permission_diagnostic_identifies_operation_without_private_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private = root / 'secret-file'
            private.write_text('private contents')
            private.chmod(0o600)
            with self.assertRaises(copy.StorageCopyError) as result:
                with copy.filesystem_step('set-copy-permissions', private, root):
                    raise PermissionError(13, 'Denied', str(private))
            message = str(result.exception)
            self.assertIn('step=set-copy-permissions', message)
            self.assertIn('location=entry', message)
            self.assertIn('mode=0600', message)
            self.assertNotIn('secret-file', message)
            self.assertNotIn('private contents', message)

    def test_copy_read_failure_has_distinct_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(copy, 'inventory', side_effect=[{}, PermissionError(13, 'Denied')]):
                with self.assertRaisesRegex(copy.StorageCopyError, 'step=after-permissions-read-copy'):
                    copy.verify_copy(Path(tmp), Path(tmp), phase='after-permissions')


    def test_readonly_copy_with_stricter_permissions_needs_no_chmod(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'target'
            source.mkdir()
            (source / 'object').write_bytes(b'git object')
            (source / 'object').chmod(0o444)
            copy.copy_verified(source, target)
            (target / 'object').chmod(0o400)
            with patch.object(copy.os, 'chmod', side_effect=PermissionError(13, 'Denied')):
                copy.prepare_copy(source, target, os.getuid())
            copy.check_service_access(target)
            self.assertEqual((target / 'object').stat().st_mode & 0o777, 0o400)

    def test_permissions_set_before_ownership_children_before_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'source', Path(tmp) / 'target'
            source.mkdir()
            (source / 'file').write_text('data')
            (source / 'file').chmod(0o600)
            copy.copy_verified(source, target)
            (target / 'file').chmod(0o644)
            events = []
            chmod = copy.os.chmod
            def record_chmod(path, mode):
                events.append(('chmod', path.name))
                chmod(path, mode)
            def record_chown(path, *args, **kwargs):
                events.append(('chown', path.name))
            with patch.object(copy.os, 'chmod', side_effect=record_chmod), patch.object(copy.os, 'chown', side_effect=record_chown):
                copy.prepare_copy(source, target, os.getuid() + 1)
            self.assertEqual(events, [('chmod', 'file'), ('chown', 'file'), ('chown', 'target')])

if __name__ == '__main__':
    unittest.main()
