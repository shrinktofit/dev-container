import type { LoginResult, SdkCommand } from './sdk-protocol.js';

export interface DevContainerUser {
  readonly id: string;
}

// Serialized into iframe guests as well: all runtime inputs are explicit.
export function createRuntimeSdk(
  request: (command: SdkCommand) => Promise<unknown>,
  commands: typeof SdkCommand,
) {
  return Object.freeze({
    account: Object.freeze({
      async login(): Promise<DevContainerUser> {
        const result = (await request(commands.login)) as LoginResult;
        return { id: result.user.id };
      },
      async getUser(): Promise<DevContainerUser | undefined> {
        return (await request(commands.getUser)) as DevContainerUser | undefined;
      },
      async logout(): Promise<void> {
        await request(commands.logout);
      },
    }),
  });
}
