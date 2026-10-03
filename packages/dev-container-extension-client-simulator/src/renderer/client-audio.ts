import { reactive } from 'vue';
const mutedByClient = reactive(new Map<string, boolean>());
export function initializeClientAudio(id: string, muted: boolean): void {
  if (!mutedByClient.has(id)) {
    mutedByClient.set(id, muted);
  }
}
export function getClientMuted(id: string): boolean {
  return mutedByClient.get(id) ?? true;
}
export function setClientMuted(id: string, muted: boolean): void {
  mutedByClient.set(id, muted);
}
