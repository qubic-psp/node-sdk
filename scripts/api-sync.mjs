// yarn api:sync — takes the merchant API OpenAPI from the sibling gateway repo (docs/openapi.public.json),
// stores a copy in api/openapi.v1.json and regenerates src/generated/schema.d.ts (openapi-typescript).
// The generated types are used only by the tests: they check the hand-written public types of src/types.ts.
//
//   yarn api:sync                        # from ../gateway/docs/openapi.public.json
//   yarn api:sync path/to/openapi.json   # from another file
//   yarn api:check                       # exits 1 when the copy or the types differ from gateway
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const source = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(root, '../gateway/docs/openapi.public.json'));
const copy = resolve(root, 'api/openapi.v1.json');
const types = resolve(root, 'src/generated/schema.d.ts');
const generator = resolve(root, 'node_modules/.bin/openapi-typescript');

if (!existsSync(source)) {
  console.error(`No file ${source}: pass the path to openapi.public.json of gateway`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(source, 'utf8'));
const operations = Object.values(spec.paths ?? {}).flatMap((item) =>
  Object.keys(item).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)),
);
const generate = (input, output) => execFileSync(generator, [input, '-o', output], { stdio: 'pipe' });

if (check) {
  const dir = mkdtempSync(join(tmpdir(), 'psp-sdk-api-'));
  try {
    const fresh = join(dir, 'schema.d.ts');
    generate(source, fresh);
    const stale = [];
    if (!existsSync(copy) || readFileSync(copy, 'utf8') !== readFileSync(source, 'utf8'))
      stale.push('api/openapi.v1.json');
    if (!existsSync(types) || readFileSync(types, 'utf8') !== readFileSync(fresh, 'utf8')) {
      stale.push('src/generated/schema.d.ts');
    }
    if (stale.length) {
      console.error(`Stale: ${stale.join(', ')} — run yarn api:sync and review the type errors`);
      process.exit(1);
    }
    console.log(`api: up to date with ${source} (${operations.length} operations)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  if (source !== copy) copyFileSync(source, copy);
  generate(copy, types);
  console.log(`api/openapi.v1.json: ${operations.length} operations; types: src/generated/schema.d.ts`);
}
