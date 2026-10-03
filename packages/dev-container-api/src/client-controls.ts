export interface ClientControls {
  userId(): string;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
const clients = new Map<string, ClientControls>();
const labels = new Map<string, string>();
export function listClientBindings() {
  return [...clients].map(([id, client]) => ({
    id,
    userId: client.userId(),
    label: labels.get(id)!,
  }));
}
export function registerClientControls(
  id: string,
  controls: ClientControls,
  label: string,
): () => void {
  clients.set(id, controls);
  labels.set(id, label);
  window.dispatchEvent(new Event('dev-container:clients-changed'));
  return () => {
    clients.delete(id);
    labels.delete(id);
    window.dispatchEvent(new Event('dev-container:clients-changed'));
  };
}
export async function stopUserClients(userId: string): Promise<void> {
  const affected = [...clients.values()].filter((client) => client.userId() === userId);
  // Stop the selected clients before rebuilding their layout.
  const stopped: ClientControls[] = [];
  try {
    for (const client of affected) {
      await client.stop();
      stopped.push(client);
    }
  } catch (error) {
    await Promise.allSettled(stopped.map((client) => client.restart()));
    throw error;
  }
}
