import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await test('public package bare specifier imports ESM and provides declarations', () => {
  /// @case A consumer receives only the SDK manifest and built lib folder.
  /// @expect Bare-specifier JavaScript import is side-effect-free and public readonly ID-only
  /// account types compile and the removed storage entry is unavailable.
  const sdk = join(root, 'packages/dev-container-sdk'),
    consumer = join(root, '.test-runs', 'consumer-' + Date.now()),
    installed = join(consumer, 'node_modules/@bsgames/dev-container-sdk');
  mkdirSync(installed, {
    recursive: true,
  });
  cpSync(sdk + '/lib', installed + '/lib', {
    recursive: true,
  });
  cpSync(sdk + '/package.json', installed + '/package.json');
  writeFileSync(
    consumer + '/package.json',
    JSON.stringify({
      type: 'module',
    }),
  );
  const manifest = JSON.parse(readFileSync(installed + '/package.json', 'utf8')) as {
    private: boolean;
    publishConfig: { access: string };
    files: string[];
  };
  assert.equal(manifest.private, false);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.deepEqual(manifest.files, ['lib']);
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      (
        'import {account,isAvailable} from '
        + '\'@bsgames/dev-container-sdk\'; console.log(isAvailable());'
      ),
    ],
    {
      cwd: consumer,
      encoding: 'utf8',
    },
  );
  assert.equal(output.trim(), 'false');
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      (
        'import assert from \'node:assert/strict\'; import * as sdk '
        + 'from \'@bsgames/dev-container-sdk\'; '
        + 'assert.deepEqual(Object.keys(sdk).sort(), '
        + '[\'account\',\'isAvailable\']);'
      ),
    ],
    { cwd: consumer },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      (
        'import assert from \'node:assert/strict\'; await '
        + (
          'assert.rejects(import(\'@bsgames/dev-container-sdk/'
          + 'storage\'), { code: \'ERR_PACKAGE_PATH_NOT_EXPORTED\' });'
        )
      ),
    ],
    { cwd: consumer, encoding: 'utf8' },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      (
        'import assert from \'node:assert/strict\'; await '
        + (
          'assert.rejects(import(\'@bsgames/dev-container-sdk/'
          + 'protocol\'), { code: \'ERR_PACKAGE_PATH_NOT_EXPORTED\' });'
        )
      ),
    ],
    { cwd: consumer },
  );
  writeFileSync(
    consumer + '/consumer.ts',
    (
      'import {account,isAvailable,type DevContainerUser,type '
      + 'DevContainerAccount} from '
      + '\'@bsgames/dev-container-sdk\';\nasync function game(){\n  '
      + 'if (!isAvailable()) return;\n  const '
      + 'api:DevContainerAccount=account;\n  const '
      + 'user:DevContainerUser=await api.login();\n  // '
      + '@ts-expect-error user identity is readonly\n  '
      + 'user.id=\'changed\';\n  // @ts-expect-error host labels are '
      + 'not SDK profile fields\n  void user.name;\n  // '
      + '@ts-expect-error account does not expose an image profile\n  '
      + 'void user.avatar;\n  return user;\n}\nvoid game;\n'
    ),
  );
  execFileSync(
    process.execPath,
    [
      root + '/node_modules/typescript/bin/tsc',
      '--strict',
      '--noEmit',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      'consumer.ts',
    ],
    {
      cwd: consumer,
      stdio: 'pipe',
    },
  );
});
