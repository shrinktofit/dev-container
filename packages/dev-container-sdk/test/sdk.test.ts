import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DevContainerAccount } from '../lib/index.js';

await test('ordinary preview can import the SDK without a host', async () => {
  /// @case The SDK is imported in an environment without a Dev Container runtime.
  /// @expect Import succeeds, availability is false and account is honestly absent.
  const sdk = await import(
    new URL('../lib/index.js?ordinary', import.meta.url).href,
  );
  assert.equal(sdk.isAvailable(), false);
  assert.equal(sdk.account, undefined);
});

await test((
  'SDK exports the account installed by the runtime before game '
  + 'modules load'
), async (t) => {
  /// @case The host installs its account API before the game imports the SDK.
  /// @expect The export is the same object, import performs no calls and host state and errors are
  /// preserved.
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__devContainer');
  const user = { id: '00000000-0000-4000-8000-000000000000' };
  let logged = false;
  let released = false;
  const calls: string[] = [];
  const hostAccount: DevContainerAccount = {
    async login() {
      calls.push('login');
      if (released) {
        throw new Error('Client session was released.');
      }
      logged = true;
      return user;
    },
    async getUser() {
      calls.push('get-user');
      if (released) {
        throw new Error('Client session was released.');
      }
      return logged ? user : undefined;
    },
    async logout() {
      calls.push('logout');
      if (released) {
        throw new Error('Client session was released.');
      }
      logged = false;
    },
  };
  Object.defineProperty(globalThis, '__devContainer', {
    value: { account: hostAccount },
    configurable: true,
  });
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, '__devContainer', previous);
    } else {
      Reflect.deleteProperty(globalThis, '__devContainer');
    }
  });
  const sdk = await import(
    new URL('../lib/index.js?host', import.meta.url).href,
  );
  assert.equal(sdk.isAvailable(), true);
  assert.equal(sdk.account, hostAccount);
  assert.deepEqual(calls, []);
  const account = sdk.account as DevContainerAccount;
  assert.equal(await account.getUser(), undefined);
  assert.deepEqual(await Promise.all([account.login(), account.login()]), [user, user]);
  assert.deepEqual(await account.getUser(), user);
  await account.logout();
  assert.equal(await account.getUser(), undefined);
  logged = true;
  assert.deepEqual(await account.getUser(), user);
  released = true;
  await assert.rejects(account.login(), /released/);
  await assert.rejects(account.getUser(), /released/);
  await assert.rejects(account.logout(), /released/);
});

await test((
  'availability identifies the runtime independently of account '
  + 'capabilities'
), async (t) => {
  /// @case A runtime object exists without an account capability.
  /// @expect isAvailable reports runtime presence rather than account presence.
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__devContainer');
  Object.defineProperty(globalThis, '__devContainer', {
    value: {},
    configurable: true,
  });
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, '__devContainer', previous);
    } else {
      Reflect.deleteProperty(globalThis, '__devContainer');
    }
  });
  const sdk = await import(
    new URL('../lib/index.js?runtime-only', import.meta.url).href,
  );
  assert.equal(sdk.account, undefined);
  assert.equal(sdk.isAvailable(), true);
});
