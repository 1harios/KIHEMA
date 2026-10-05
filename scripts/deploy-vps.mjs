// Explicit invocation only: archive path and an already-authorized SSH key.
// The private values travel over encrypted SSH stdin, never argv or a file.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnv } from 'vite';

const [archive, identity] = process.argv.slice(2);
if (!archive || !identity || !existsSync(archive) || !existsSync(identity)) {
	throw new Error('Usage: node scripts/deploy-vps.mjs <release.tar.gz> <SSH-key>');
}
const env = loadEnv('production', process.cwd(), '');
const payload = Object.fromEntries(['TMDB_READ_TOKEN', 'TMDB_API_KEY', 'TMDB_LANGUAGE', 'TMDB_REGION']
	.map((name) => [name, env[name]?.trim() || '']));
if (!payload.TMDB_READ_TOKEN && !payload.TMDB_API_KEY) throw new Error('Private TMDB configuration missing');
payload.TMDB_LANGUAGE ||= 'ru-RU';
payload.TMDB_REGION ||= 'RU';
payload.SESSION_SECRET = randomBytes(32).toString('hex');
const options = ['-i', identity, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const host = 'root@93.123.84.128';
const stage = execFileSync('ssh', [...options, host, 'mktemp -d /opt/kihema/mirror-stage-XXXXXXXX'], { encoding: 'utf8' }).trim();
if (!/^\/opt\/kihema\/mirror-stage-[a-zA-Z0-9]+$/.test(stage)) throw new Error('Unexpected staging path');
execFileSync('scp', [...options, archive, `${host}:${stage}/release.tar.gz`], { stdio: 'inherit' });
execFileSync('scp', [...options, 'deploy/vps/Caddyfile', 'deploy/vps/party-server.py',
	'deploy/vps/kihema-web.service', 'deploy/vps/install-web.py', `${host}:${stage}/`], { stdio: 'inherit' });
const installed = execFileSync('ssh', [...options, host, `python3 ${stage}/install-web.py ${stage}`], {
	input: JSON.stringify(payload), encoding: 'utf8', timeout: 180_000,
	stdio: ['pipe', 'pipe', 'inherit']
});
console.log(installed.trim());
