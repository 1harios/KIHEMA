#!/usr/bin/env python3
"""Root-side mirror installer. Private TMDB values arrive only through stdin."""
import datetime
import grp
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


assert os.geteuid() == 0, 'root required'
stage = Path(sys.argv[1]).resolve()
assert stage.parent == Path('/opt/kihema') and re.fullmatch(r'mirror-stage-[a-zA-Z0-9]+', stage.name)
payload = json.load(sys.stdin)
allowed = {'TMDB_READ_TOKEN', 'TMDB_API_KEY', 'TMDB_LANGUAGE', 'TMDB_REGION', 'SESSION_SECRET'}
assert set(payload) <= allowed
assert all(isinstance(v, str) and not any(c in v for c in '\r\n\0') for v in payload.values())
assert payload.get('TMDB_READ_TOKEN') or payload.get('TMDB_API_KEY'), 'TMDB credentials missing'
assert len(payload.get('SESSION_SECRET', '')) >= 32, 'production session secret missing'
key = next(line.split('=', 1)[1].strip() for line in Path('/etc/kihema/caddy.env').read_text().splitlines()
           if line.startswith('KIHEMA_API_KEY='))
assert re.fullmatch(r'[a-fA-F0-9]{64}', key), 'unexpected private API key format'
environment = {
    **payload,
    'ORIGIN': 'https://kihema.93-123-84-128.sslip.io',
    'DEMO_MODE': 'false',
    'INDEX_PATH': '/var/lib/kihema/web/index.json',
    'TORRSERVER_ENABLED': 'true',
    'TORRSERVER_URL': 'https://video.93-123-84-128.sslip.io',
    'TORRSERVER_API_KEY': key,
    'TORRENTIO_ENABLED': 'true',
    'TORRENTIO_URL': 'https://torrentio.strem.fun',
    'JACKETT_URL': 'https://jac.red',
    'PARTY_SERVER_URL': 'https://kihema.93-123-84-128.sslip.io/party',
}
if Path('/etc/kihema/web.env').exists():
    # Normal updates must not invalidate existing signed sessions.
    line = next(line for line in Path('/etc/kihema/web.env').read_text().splitlines()
                if line.startswith('SESSION_SECRET='))
    previous_secret = shlex.split(line.split('=', 1)[1])
    assert len(previous_secret) == 1 and len(previous_secret[0]) >= 32
    environment['SESSION_SECRET'] = previous_secret[0]
caddy_env = {**os.environ, 'KIHEMA_API_KEY': key}
run('caddy', 'fmt', '--overwrite', str(stage / 'Caddyfile'))
run('caddy', 'validate', '--config', str(stage / 'Caddyfile'), '--adapter', 'caddyfile', env=caddy_env)
run('/opt/kihema/venv/bin/python', '-B', '-c',
    'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', str(stage / 'party-server.py'))
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
release = Path('/opt/kihema/web/releases') / stamp
release.mkdir(parents=True, exist_ok=False)
with tarfile.open(stage / 'release.tar.gz') as archive:
    archive.extractall(release, filter='data')
assert (release / 'build/index.js').is_file()
assert not (release / '.env').exists()
for parent, directories, files in os.walk(release):
    os.chmod(parent, 0o755)
    for name in files:
        path = Path(parent) / name
        if not path.is_symlink():
            os.chmod(path, 0o644)
data = Path('/var/lib/kihema/web')
data.mkdir(parents=True, exist_ok=True)
os.chown(data, pwd.getpwnam('kihema').pw_uid, grp.getgrnam('kihema').gr_gid)
os.chmod(data, 0o750)
backup = Path('/etc/kihema/backups') / ('mirror-' + stamp)
backup.mkdir(parents=True, mode=0o700, exist_ok=False)
os.chmod(backup.parent, 0o700)
targets = [Path('/etc/caddy/Caddyfile'), Path('/opt/kihema/party-server.py'),
           Path('/etc/systemd/system/kihema-web.service'), Path('/etc/kihema/web.env')]
existing = {}
for target in targets:
    if target.exists():
        saved = backup / target.name
        shutil.copy2(target, saved)
        existing[target] = saved
current = Path('/opt/kihema/web/current')
assert not current.exists() or current.is_symlink(), 'current must be a release symlink'
previous = os.readlink(current) if current.is_symlink() else None
(backup / 'current-target.txt').write_text((previous or '') + '\n')
next_link = current.with_name('current.next')
assert not next_link.exists() and not next_link.is_symlink()
web_was_enabled = subprocess.run(['systemctl', 'is-enabled', '--quiet', 'kihema-web']).returncode == 0
party_changed = False
caddy_changed = False
try:
    # EnvironmentFile accepts double-quoted values; don't let quotes/backslashes
    # alter parsing. This file never enters the archive or command line.
    env_file = Path('/etc/kihema/web.env')
    with open(env_file, 'w', opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
        os.chmod(env_file, 0o600)
        for name, value in environment.items():
            escaped = value.replace('\\', '\\\\').replace('"', '\\"')
            output.write(f'{name}="{escaped}"\n')
    shutil.copy2(stage / 'kihema-web.service', targets[2])
    os.chmod(targets[2], 0o644)
    next_link.symlink_to(release)
    next_link.replace(current)
    run('systemctl', 'daemon-reload')
    run('systemctl', 'restart', 'kihema-web')
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000/api/party/url', timeout=2) as response:
                result = json.load(response)
                assert result.get('url') == environment['PARTY_SERVER_URL']
            break
        except (OSError, AssertionError):
            if attempt == 29:
                raise RuntimeError('Node health check failed') from None
            time.sleep(1)
    if (stage / 'party-server.py').read_bytes() != targets[1].read_bytes():
        shutil.copy2(stage / 'party-server.py', targets[1])
        party_changed = True
        run('systemctl', 'restart', 'kihema-party')
    shutil.copy2(stage / 'Caddyfile', targets[0])
    caddy_changed = True
    run('systemctl', 'reload', 'caddy')
    run('systemctl', 'enable', 'kihema-web')
    print(json.dumps({'installed': str(release), 'backup': str(backup), 'url': environment['ORIGIN']}))
except Exception:
    # Restore only these exact files/symlink. Previous releases are retained.
    if targets[2] not in existing:
        subprocess.run(['systemctl', 'stop', 'kihema-web'], check=False)
    if not web_was_enabled:
        subprocess.run(['systemctl', 'disable', 'kihema-web'], check=False)
    for target in targets:
        if target in existing:
            shutil.copy2(existing[target], target)
        elif target.exists():
            target.unlink()
    if previous:
        if next_link.is_symlink():
            next_link.unlink()
        next_link.symlink_to(previous)
        next_link.replace(current)
    elif current.is_symlink():
        current.unlink()
    run('systemctl', 'daemon-reload')
    if targets[2] in existing:
        run('systemctl', 'restart', 'kihema-web')
    if party_changed:
        run('systemctl', 'restart', 'kihema-party')
    if caddy_changed:
        run('systemctl', 'reload', 'caddy')
    raise
