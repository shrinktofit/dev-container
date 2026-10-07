import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/eslint-changed-files.ts');

await test((
  'changed-file lint selects committed source changes and '
  + 'rejects errors and warnings'
), (t) => {
  /// @case A repository keeps an unchanged lint error, then commits a valid source, an error, a
  /// warning, and deletions.
  /// @expect The TypeScript CLI checks only eligible changed files, handles spaces in paths, and
  /// fails on errors, warnings or invalid arguments.
  const testRoot = join(import.meta.dirname, '../.test-runs');
  mkdirSync(testRoot, { recursive: true });
  const directory = mkdtempSync(join(testRoot, 'lint-cli-'));
  t.after(() => {
    assert.ok(directory.startsWith(testRoot + sep));
    rmSync(directory, { recursive: true, force: true });
  });

  function git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  }

  function commit(message: string): void {
    git('add', '--', '.');
    git('commit', '-m', message);
  }

  function lint(...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Dev Container Tests');
  git('config', 'user.email', 'dev-container-tests@example.invalid');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'eslint.config.js'),
    (
      'export default [{ files: [\'**/*.ts\'], rules: { '
      + '\'no-debugger\': \'error\', \'no-console\': \'warn\' } }];'
    ),
  );
  writeFileSync(join(directory, 'unchanged.ts'), 'debugger;');
  commit('fixture base');
  const base = git('rev-parse', 'HEAD');
  assert.equal(lint('--base-ref', base).status, 0);
  const changed = join(directory, 'changed client.ts');
  writeFileSync(changed, 'export const value = 42;');
  commit('valid source');
  assert.equal(lint('--base-ref', base).status, 0);
  writeFileSync(changed, 'debugger;');
  commit('lint error');
  const error = lint('--base-ref', base);
  assert.equal(error.status, 1);
  assert.match(error.stdout, /no-debugger/);
  writeFileSync(changed, 'console.log(\'warning\');');
  commit('lint warning');
  const warning = lint('--base-ref', base);
  assert.equal(warning.status, 1);
  assert.match(warning.stdout, /no-console/);
  rmSync(changed);
  rmSync(join(directory, 'unchanged.ts'));
  commit('delete sources');
  assert.equal(lint('--base-ref', base).status, 0);
  assert.notEqual(lint('--base-ref', 'missing-ref').status, 0);
  assert.match(lint().stderr, /Usage:/);
});
