import type { SdkEvent } from '@bsgames/dev-container-api/sdk-protocol';
interface FrameApi {
  prepareIframeSdk(token: string): Promise<void>;
  invokeIframeSdk(token: string, command: string): Promise<unknown>;
  onIframeSdkEvent(callback: (message: { token: string; event: SdkEvent }) => void): () => void;
}
export async function attachIframeTransport(
  token: string,
  getFrame: () => HTMLIFrameElement | undefined,
): Promise<() => void> {
  const api = (
    window as unknown as {
      devContainer: FrameApi;
    }
  ).devContainer;
  await api.prepareIframeSdk(token);
  let port: MessagePort | undefined;
  const listener = (event: MessageEvent) => {
    if (
      event.source !== getFrame()?.contentWindow
      || event.data?.type !== 'dev-container:iframe-port'
      || event.data.token !== token
      || !event.ports[0]
    ) {
      return;
    }
    port?.close();
    port = event.ports[0];
    port.onmessage = async (event) => {
      const { id, command } = event.data;
      try {
        port?.postMessage({
          id,
          result: await api.invokeIframeSdk(token, command),
        });
      } catch (error) {
        port?.postMessage({
          id,
          error: String(error),
        });
      }
    };
    port.start();
  };
  window.addEventListener('message', listener);
  const unsubscribe = api.onIframeSdkEvent((message) => {
    if (message.token === token) {
      port?.postMessage({
        type: 'event',
        event: message.event,
      });
    }
  });
  return () => {
    window.removeEventListener('message', listener);
    unsubscribe();
    port?.close();
  };
}
