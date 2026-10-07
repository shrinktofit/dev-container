import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';

const appDirectory = resolve(import.meta.dirname, '../packages/dev-container');
const require = createRequire(join(appDirectory, 'package.json'));
const electron: string = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function runApp(args: string[], cwd: string) {
  const result = spawnSync(electron, [
    appDirectory,
    ...args,
  ], {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  assert.ifError(result.error);
  return result;
}

function probe(args: string[], cwd: string) {
  return runApp(['probe', ...args], cwd);
}

void test('opening a game requires an explicit directory', (t) => {
  /// @case Invoke launch with no directory, a blank value, extra arguments or the removed option.
  /// @expect Invalid inputs exit with code 2 without creating game state; help exits successfully.
  const game = mkdtempSync(join(tmpdir(), 'dev-container launch-'));
  t.after(() => rmSync(game, { recursive: true, force: true }));
  for (const args of [
    [],
    [''],
    ['   '],
    [game, 'extra'],
    ['--game', game],
  ]) {
    const result = runApp(args, game);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.trim());
  }
  const help = runApp(['--help'], game);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /<directory>/u);
  assert.equal(existsSync(join(game, '.dev-container')), false);
});

void test('probe queries an unopened directory without requiring configuration', (t) => {
  /// @case Query relative/absolute paths, including spaces and invalid targets.
  /// @expect No instance returns false/code 1; errors return code 2 without opening a window.
  const game = mkdtempSync(join(tmpdir(), 'dev-container probe-'));
  t.after(() => rmSync(game, { recursive: true, force: true }));
  for (const args of [
    ['.'],
    [game],
  ]) {
    const result = probe(args, game);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { running: false });
  }
  assert.equal(existsSync(join(game, '.dev-container/users.json')), false);
  const help = probe(['--help'], game);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Check whether the target game already has an instance/u);
  for (const args of [
    [],
    [''],
    ['   '],
    [join(game, 'missing')],
    ['.', 'extra'],
    ['--game', game],
    ['.', '--unknown'],
    ['.', '--remote-debugging-port'],
    ['.', '--remote-debugging-port=-1'],
    ['.', '--remote-debugging-port=65536'],
    ['.', '--remote-debugging-port=abc'],
  ]) {
    const result = probe(args, game);
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.trim());
  }
});

for (const validConfig of [true, false]) {
  void test(`probe detects and releases a ${validConfig ? 'normal' : 'configuration-error'} instance`, { timeout: 30000 }, async (t) => {
    /// @case Run one target, query it and another target, then terminate the owned process.
    /// @expect Running returns true/code 0; other and closed targets return false/code 1.
    const game = mkdtempSync(join(tmpdir(), 'dev-container-probe-'));
    const other = mkdtempSync(join(tmpdir(), 'dev-container-probe-other-'));
    writeFileSync(join(game, 'dev-container.config.yaml'), JSON.stringify(validConfig
      ? { version: 1, game: { id: 'probe-test', title: 'Probe test' } }
      : { version: 999 }));
    const child = spawn(electron, [
      appDirectory,
      game,
    ], {
      cwd: game,
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
    await once(child, 'spawn');
    t.after(() => {
      if (child.exitCode === null) {
        if (process.platform === 'win32') {
          spawnSync('taskkill.exe', [
            '/PID',
            String(child.pid),
            '/T',
            '/F',
          ], { windowsHide: true });
        } else {
          child.kill();
        }
      }
      rmSync(game, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      rmSync(other, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    });
    const deadline = Date.now() + 10000;
    let running = false;
    while (Date.now() < deadline) {
      // Let the launched process acquire its lock before the first probe.
      await new Promise((accept) => setTimeout(accept, 100));
      const result = probe([game], other);
      if (result.status === 0) {
        assert.deepEqual(JSON.parse(result.stdout), { running: true });
        running = true;
        break;
      }
      assert.equal(result.status, 1, result.stderr);
      assert.equal(child.exitCode, null);
    }
    assert.equal(running, true);
    assert.equal(probe([other], game).status, 1);
    if (process.platform === 'win32') {
      const differentlyCased = probe([game.toUpperCase()], other);
      assert.equal(differentlyCased.status, 0, differentlyCased.stderr);
    }
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    const result = probe([game], other);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { running: false });
  });
}
