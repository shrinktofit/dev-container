import type { DevContainerMainExtension } from '@bsgames/dev-container-api';
export const accountMainExtension: DevContainerMainExtension = {
  id: 'account',
  activate(ctx) {
    ctx.extensionIpc.handle('list', () => ctx.runtime.listUsers());
    ctx.extensionIpc.handle('create', (value) => {
      const input = value as { name: string };
      return ctx.runtime.createUser(input.name);
    });
    ctx.extensionIpc.handle('rename', (value) => {
      const input = value as { id: string; name: string };
      return ctx.runtime.renameUser(input.id, input.name);
    });
  },
};
