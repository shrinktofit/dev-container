import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { ESLint } from 'eslint';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--base-ref') {
  throw new Error('Usage: node --run lint:changed -- --base-ref <branch-or-commit>');
}
const base = args[1];
execFileSync('git', [
  'rev-parse',
  '--verify',
  base,
], { stdio: 'pipe' });
const files = execFileSync('git', [
  'diff',
  '--name-only',
  '-z',
  '--diff-filter=ACMR',
  base + '...HEAD',
], { encoding: 'utf8' }).split('\0').filter((file) => /\.(?:[cm]?js|tsx?|vue)$/.test(file));
if (files.length) {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(files);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) {
    console.log(output);
  }
  if (results.some((result) => result.errorCount || result.warningCount)) {
    process.exitCode = 1;
  }
} else {
  console.log('No JavaScript, TypeScript or Vue changes to lint.');
}
