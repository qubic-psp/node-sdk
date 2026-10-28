// yarn smoke — packs the package (npm pack runs the build), installs the tarball into a temp project and runs
// test/smoke/consumer.{mjs,cjs} there with import() and require(). Extra Node.js binaries to try:
//   SMOKE_NODES="$HOME/.nvm/versions/node/v20.10.0/bin/node $HOME/.nvm/versions/node/v24.9.0/bin/node" yarn smoke
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'psp-sdk-smoke-'));
const nodes = [process.execPath, ...(process.env.SMOKE_NODES ?? '').split(/\s+/).filter(Boolean)];
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

try {
  const tarball = run('npm', ['pack', '--silent', '--pack-destination', dir], root).trim().split('\n').pop();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', '--offline', join(dir, tarball)], dir);
  copyFileSync(join(root, 'test/smoke/consumer.mjs'), join(dir, 'consumer.mjs'));
  copyFileSync(join(root, 'test/smoke/consumer.cjs'), join(dir, 'consumer.cjs'));
  for (const node of nodes) {
    process.stdout.write(run(node, ['consumer.mjs'], dir));
    process.stdout.write(run(node, ['consumer.cjs'], dir));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
