import type { DevContainerMainExtension } from '@bsgames/dev-container-api';
import type { LaunchOverrides } from '@bsgames/dev-container-api/game-config';
export const clientSimulatorMainExtension: DevContainerMainExtension = {
  id: 'client-simulator',
  activate(ctx) {
    ctx.extensionIpc.handle('mute', (value) =>
      ctx.mainWindow.webContents.setAudioMuted((value as { muted: boolean }).muted),
    );
    ctx.extensionIpc.handle('devtools', () => ctx.mainWindow.webContents.openDevTools());
    ctx.extensionIpc.handle('host-info', () => ({
      targetDirectory: ctx.targetDirectory,
      workspaceLabel:
        /[\\/]codex-worktrees[\\/]([^\\/]+)/.exec(ctx.targetDirectory)?.[1]
        ?? ctx.targetDirectory.split(/[\\/]/).at(-1),
      devtoolsHttpOrigin: ctx.debugInfo.devtoolsHttpOrigin,
    }));
    ctx.extensionIpc.handle('preference', () => ctx.runtime.preference);
    ctx.extensionIpc.handle('config', () => ctx.runtime.config);
    ctx.extensionIpc.handle('validate-launch', (value) =>
      ctx.runtime.previewClientUrl((value as { values: LaunchOverrides }).values),
    );
    ctx.extensionIpc.handle('register-client', (value) => {
      const input = value as {
        clientId: string;
        userId: string;
        values: LaunchOverrides;
      };
      return ctx.runtime.registerClient(input.clientId, input.userId, input.values);
    });
    ctx.extensionIpc.handle('release-client', (value) =>
      ctx.runtime.releaseClient((value as { token: string }).token),
    );
    ctx.extensionIpc.handle('check-preview', async () => {
      const url = await ctx.runtime.getPreviewUrl();
      return { url };
    });
    ctx.extensionIpc.handle('reload-frame', (value) => {
      const input = value as { url: string };
      const window = ctx.mainWindow;
      const frame = window.webContents.mainFrame.framesInSubtree.find(
        (frame) => frame.url === input.url,
      );
      if (!frame) {
        throw new Error('Client iframe not found.');
      }
      return frame.reload();
    });
  },
};
