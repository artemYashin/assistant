#!/usr/bin/env python3
"""Offline Docker volume copy/verification. Never prints data or filenames."""
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys


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
            raise RuntimeError('Unsupported special file; original volume was not changed')
        result[relative] = (kind, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid, value)
        if stat.S_ISDIR(info.st_mode):
            for child in path.iterdir():
                visit(child)
    visit(root)
    return result


def copy_verified(source, destination):
    if destination.exists() or destination.is_symlink():
        raise RuntimeError('Destination already exists; refusing to overwrite')
    # cp -a retains numeric ownership, modes, timestamps and symlinks (HF cache).
    subprocess.run(['cp', '-a', str(source), str(destination)], check=True)
    original = inventory(source)
    if original != inventory(destination):
        raise RuntimeError('Verification failed; original volume was not changed')
    print(f'Verified {len(original)} entries, including SHA-256 for every regular file.')


if __name__ == '__main__':
    try:
        copy_verified(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception as error:
        # Do not leak filenames or database content to terminal logs.
        print(f'Copy/verification failed ({type(error).__name__}). Original volume retained.', file=sys.stderr)
        sys.exit(1)
