export type { DevContainerUser } from '@bsgames/dev-container-api/sdk-runtime';
type RuntimeSdk = ReturnType<
  typeof import('@bsgames/dev-container-api/sdk-runtime').createRuntimeSdk
>;

const runtime = (
  globalThis as typeof globalThis & {
    readonly __devContainer: RuntimeSdk;
  }
).__devContainer;

/** Host-only API. Check isAvailable() before using account in an ordinary browser. */
export const account = runtime?.account;
export type DevContainerAccount = typeof account;

export function isAvailable(): boolean {
  return (
    // eslint-disable-next-line unicorn/no-typeof-undefined -- Check runtime presence explicitly.
    typeof (
      globalThis as {
        readonly __devContainer?: RuntimeSdk;
      }
    ).__devContainer !== 'undefined'
  );
}
