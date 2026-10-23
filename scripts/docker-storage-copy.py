#!/usr/bin/env python3
"""Offline Docker volume copy/verification. Never prints data or filenames."""
from collections import Counter
import errno
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile


class StorageCopyError(RuntimeError):
    """Messages are safe to display: no file paths or data."""


def inventory(root):
    result = {}
    def visit(path):
        info = path.lstat()
        relative = str(path.relative_to(root))
        kind = stat.S_IFMT(info.st_mode)
        value = None
        if stat.S_ISLNK(info.st_mode):
            value = os.readlink(path)
        elif stat.S_ISREG(info.st_mode):
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            value = (info.st_size, digest.hexdigest())
        elif not stat.S_ISDIR(info.st_mode):
            raise StorageCopyError('UNSUPPORTED_FILE_TYPE: source/copy contains a socket, FIFO or device; migration stopped')
        result[relative] = (kind, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid, value)
        if stat.S_ISDIR(info.st_mode):
            for child in path.iterdir():
                visit(child)
    visit(root)
    return result


def copy_verified(source, destination):
    if destination.exists() or destination.is_symlink():
        raise StorageCopyError('DESTINATION_EXISTS: refusing to overwrite an existing copy')
    # cp -a retains numeric ownership, modes, timestamps and symlinks (HF cache).
    subprocess.run(['cp', '-a', str(source), str(destination)], check=True)
    verify_copy(source, destination)


def verify_copy(source, destination, require_metadata=True):
    if not destination.is_dir() or destination.is_symlink():
        raise StorageCopyError('COPY_NOT_FOUND: no completed directory copy at this stage')
    original = inventory(source)
    copied = inventory(destination)
    differences = Counter()
    for path in original.keys() - copied.keys():
        differences['missing_entries'] += 1
    for path in copied.keys() - original.keys():
        differences['extra_entries'] += 1
    for path in original.keys() & copied.keys():
        old, new = original[path], copied[path]
        for index, category in enumerate(('file_type', 'mode', 'uid', 'gid', 'content_or_link')):
            if old[index] != new[index]:
                differences[category] += 1
                if path == '.':
                    differences['root_' + category] += 1
    if not require_metadata:
        differences = Counter({key: value for key, value in differences.items()
                               if key in ('missing_entries', 'extra_entries', 'file_type', 'content_or_link')})
    if differences:
        counts = ', '.join(f'{key}={value}' for key, value in sorted(differences.items()))
        data_changed = any(differences[key] for key in ('missing_entries', 'extra_entries', 'file_type', 'content_or_link'))
        category = 'DATA_MISMATCH' if data_changed else 'METADATA_MISMATCH'
        message = f'{category}: {counts}.'
        if not data_changed:
            message += ' File contents and symlink targets match; ownership/permissions differ. Verification has NOT been bypassed.'
        raise StorageCopyError(message)
    print(f'Verified {len(original)} entries, including SHA-256 for every regular file.')
    return original


def prepare_copy(source, destination, uid):
    if not destination.exists() and not destination.is_symlink():
        subprocess.run(['cp', '-a', str(source), str(destination)], check=True)
    # No permission changes until all bytes, paths and symlinks are verified.
    original = verify_copy(source, destination, require_metadata=False)
    ownership_warnings = 0
    for relative, entry in original.items():
        target = destination / relative
        try:
            os.chown(target, uid, uid, follow_symlinks=False)
        except PermissionError:
            # Some host-shared filesystems map ownership. Runtime access is
            # checked separately in a container running as the actual service UID.
            ownership_warnings += 1
        if entry[0] != stat.S_IFLNK:
            os.chmod(target, entry[1] & 0o777)
            if stat.S_IMODE(target.lstat().st_mode) & 0o077 & ~(entry[1] & 0o077):
                raise StorageCopyError('UNSAFE_PERMISSIONS: copy grants broader group/other access than the source')
    if ownership_warnings:
        print(f'Ownership mapping: {ownership_warnings} entries could not be chowned; service access check is mandatory.')
    verify_copy(source, destination, require_metadata=False)
    print(f'Copy prepared for service UID/GID {uid}; actual access must be checked before use.')


def check_service_access(root):
    # Executed as the service UID, with only its copied directory mounted.
    entries = 0
    def visit(path):
        nonlocal entries
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            return
        required = os.R_OK
        if stat.S_ISDIR(info.st_mode):
            required |= os.X_OK
        if info.st_mode & 0o222:
            required |= os.W_OK
        if not os.access(path, required):
            raise StorageCopyError(f'SERVICE_ACCESS_DENIED: UID {os.getuid()} cannot access all copied entries')
        entries += 1
        if stat.S_ISDIR(info.st_mode):
            for child in path.iterdir():
                visit(child)
    visit(root)
    # Check real create/write/fsync/rename/delete, not just metadata bits.
    with tempfile.TemporaryDirectory(prefix='.orbit-access-', dir=root) as temporary:
        path = Path(temporary) / 'probe'
        with path.open('wb') as stream:
            stream.write(b'access test')
            stream.flush()
            os.fsync(stream.fileno())
        path.rename(Path(temporary) / 'renamed')
    print(f'Service access verified: UID/GID {os.getuid()}/{os.getgid()}, {entries} entries, read/write/rename/delete succeeded.')


def safe_error(error):
    if isinstance(error, StorageCopyError):
        return str(error)
    if isinstance(error, OSError):
        return f'FILESYSTEM_ERROR: {errno.errorcode.get(error.errno, "UNKNOWN")} ({type(error).__name__})'
    if isinstance(error, subprocess.CalledProcessError):
        return f'COPY_COMMAND_FAILED: exit code {error.returncode}'
    return f'UNEXPECTED_ERROR: {type(error).__name__}'


if __name__ == '__main__':
    try:
        if sys.argv[1] == '--prepare':
            prepare_copy(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]))
        elif sys.argv[1] == '--check-access':
            check_service_access(Path(sys.argv[2]))
        elif sys.argv[1] == '--verify':
            verify_copy(Path(sys.argv[2]), Path(sys.argv[3]))
        else:
            copy_verified(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception as error:
        # Do not leak filenames or database content to terminal logs.
        print(f'Copy/verification failed: {safe_error(error)} Original volume retained.', file=sys.stderr)
        sys.exit(1)
