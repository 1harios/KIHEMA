// Build a secret-free Node release. Never copy .env, .vercel or local databases.
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run build:vps');
function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
run(process.execPath, [npmCli, 'run', 'build'], {
	env: { ...process.env, VERCEL: '0', ADAPTER: 'node' }
});
const stage = mkdtempSync(join(tmpdir(), 'kihema-web-release-'));
for (const name of ['build', 'package.json', 'package-lock.json']) {
	cpSync(name, join(stage, name), { recursive: true });
}
// Locked production dependencies only. They are pure JS; no Windows binaries
// or dev/build tools are included in the Linux runtime release.
run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
	cwd: stage
});
const archive = join(stage, 'release.tar.gz');
run('tar', ['-czf', archive, '-C', stage, 'build', 'package.json', 'package-lock.json', 'node_modules']);
console.log(JSON.stringify({ archive, stage }));
