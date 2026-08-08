import { cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = join(root, 'extension');
const stat = join(root, 'static');

const compilerVersion = execFileSync('tsc', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
if (compilerVersion !== 'Version 5.8.3') {
  throw new Error(`KopelaEQ release build requires TypeScript 5.8.3; found ${compilerVersion}.`);
}

await rm(ext, { recursive: true, force: true });
await mkdir(join(ext, 'js'), { recursive: true });
await cp(stat, ext, { recursive: true });
execFileSync('tsc', ['-p', join(root, 'tsconfig.json')], { cwd: root, stdio: 'inherit' });
console.log('Built browser-native ESM modules with TypeScript 5.8.3.');
