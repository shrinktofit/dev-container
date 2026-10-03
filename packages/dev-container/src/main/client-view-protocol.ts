import { protocol, session, type Session, type WebFrameMain } from 'electron';
import { SdkCommand } from '@bsgames/dev-container-api/sdk-protocol';
import { createRuntimeSdk } from '@bsgames/dev-container-api/sdk-runtime';
import { ClientViewHostMode } from '@bsgames/dev-container-api/game-config';
import type { Runtime } from './host-runtime.js';
export function registerClientViewPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dev-container-client',
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
      },
    },
  ]);
}
export function installIframeBridge(
  token: string,
  commands: typeof SdkCommand,
  createSdk: typeof createRuntimeSdk,
): void {
  const channel = new MessageChannel();
  const pending = new Map<
    string,
    {
      accept(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let disconnectMessage: string | undefined;
  channel.port1.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'event') {
      disconnectMessage = message.event.message as string;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(disconnectMessage));
      }
      pending.clear();
      channel.port1.close();
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error));
    } else {
      request.accept(message.result);
    }
  };
  channel.port1.start();
  const request = (command: SdkCommand): Promise<unknown> =>
    new Promise((accept, reject) => {
      if (disconnectMessage) {
        reject(new Error(disconnectMessage));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Dev Container host request timed out: ' + command));
      }, 15000);
      pending.set(id, {
        accept,
        reject,
        timer,
      });
      channel.port1.postMessage({
        id,
        command,
      });
    });
  Object.defineProperty(window, '__devContainer', {
    configurable: false,
    value: createSdk(request, commands),
  });
  window.parent.postMessage(
    {
      type: 'dev-container:iframe-port',
      token,
    },
    '*',
    [channel.port2],
  );
}
const installedSessions = new WeakSet<Session>();

function frameToken(frame: WebFrameMain | undefined): string | undefined {
  for (let current = frame; current; current = current.parent ?? undefined) {
    const url = current.url;
    if (url.startsWith('dev-container-client://')) {
      const token = new URL(url).searchParams.get('__devContainerClient');
      if (token) {
        return token;
      }
    }
  }
  return undefined;
}

export function registerClientViewHandler(
  runtime: Runtime,
  clientSession: Session,
  mode: ClientViewHostMode,
): void {
  if (installedSessions.has(clientSession)) {
    return;
  }
  installedSessions.add(clientSession);
  // Subresources have no token in their relative URLs. Route them by their actual
  // requesting frame, so two clients of one user can still use different Vortex ports.
  clientSession.webRequest.onBeforeRequest((details, callback) => {
    const source = new URL(details.url);
    const custom = source.protocol === 'dev-container-client:';
    const socket
      = ['http:', 'https:'].includes(source.protocol)
        && source.hostname === 'dev-container-client'
        && source.pathname.startsWith('/socket.io/');
    if (!custom && !socket) {
      callback({});
      return;
    }
    try {
      const token
        = source.searchParams.get('__devContainerClient') ?? frameToken(details.frame ?? undefined);
      if (!token) {
        throw new Error('Preview request has no registered client frame: ' + source.href);
      }
      const descriptor = runtime.findBinding(token);
      if (
        descriptor.viewHost !== mode
        || (mode === ClientViewHostMode.webview
          && clientSession !== session.fromPartition(descriptor.partition))
      ) {
        throw new Error('Preview request session does not match its registered user.');
      }
      if (custom && source.hostname !== new URL(descriptor.url).hostname) {
        throw new Error('Preview request origin does not match the registered user.');
      }
      if (socket) {
        callback({
          redirectURL: new URL(source.pathname + source.search, descriptor.previewUrl).href,
        });
      } else if (!source.searchParams.has('__devContainerClient')) {
        source.searchParams.set('__devContainerClient', token);
        callback({ redirectURL: source.href });
      } else {
        callback({});
      }
    } catch (error) {
      console.error('Preview routing failed.', error);
      callback({ cancel: true });
    }
  });
  clientSession.protocol.handle('dev-container-client', async (request) => {
    const source = new URL(request.url);
    let descriptor;
    try {
      const token = source.searchParams.get('__devContainerClient');
      if (!token) {
        throw new Error('Missing client token.');
      }
      descriptor = runtime.findBinding(token);
      if (
        descriptor.viewHost !== mode
        || (mode === ClientViewHostMode.webview
          && clientSession !== session.fromPartition(descriptor.partition))
      ) {
        throw new Error('Invalid preview session.');
      }
      if (source.hostname !== new URL(descriptor.url).hostname) {
        throw new Error('Invalid preview origin.');
      }
    } catch (error) {
      return new Response('Client session has expired: ' + String(error), { status: 410 });
    }
    if (source.pathname === '/__dev_container__/bridge.js') {
      if (descriptor.viewHost !== ClientViewHostMode.iframe) {
        return new Response('Iframe bridge is unavailable for this client.', { status: 403 });
      }
      return new Response(
        '('
        + installIframeBridge.toString()
        + ')('
        + JSON.stringify(descriptor.token)
        + ','
        + JSON.stringify(SdkCommand)
        + ',('
        + createRuntimeSdk.toString()
        + '));',
        {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        },
      );
    }
    source.searchParams.delete('__devContainerClient');
    const target = new URL(source.pathname + source.search, descriptor.previewUrl);
    try {
      const headers = new Headers(request.headers);
      headers.delete('host');
      const response = await fetch(target, {
        method: request.method,
        headers,
        ...(request.method !== 'GET' && request.method !== 'HEAD'
          ? { body: await request.arrayBuffer() }
          : {}),
      });
      // Node fetch decodes compressed upstream bodies; forwarding the original
      // encoding/length would make Chromium decode them a second time.
      const resultHeaders = new Headers(response.headers);
      resultHeaders.delete('content-length');
      resultHeaders.delete('content-encoding');
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/html') && source.pathname !== '/socket.io/socket.io.js') {
        return new Response(response.body, {
          headers: resultHeaders,
          status: response.status,
          statusText: response.statusText,
        });
      }
      let text = await response.text();
      if (type.includes('text/html') && descriptor.viewHost === ClientViewHostMode.iframe) {
        const script
          = '<script src="dev-container-client://'
            + new URL(descriptor.url).hostname
            + '/__dev_container__/bridge.js?__devContainerClient='
            + descriptor.token
            + '"></script>';
        text = /<head\b[^>]*>/i.test(text)
          ? text.replace(/<head\b[^>]*>/i, (match) => match + script)
          : script + text;
      } else if (source.pathname === '/socket.io/socket.io.js') {
        // Vortex's preview Socket.IO client cannot use a custom-scheme WebSocket origin.
        text = text.replace(
          'this.transports=n.transports||["polling","websocket"]',
          'this.transports=n.transports||["polling"]',
        );
      }
      return new Response(text, {
        headers: resultHeaders,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (error) {
      console.error('Preview proxy failed: ' + target.href, error);
      return new Response('Preview unavailable: ' + target.href + '\n' + String(error), {
        status: 503,
      });
    }
  });
}
