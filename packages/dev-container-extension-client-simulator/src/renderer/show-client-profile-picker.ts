import { createApp } from 'vue';
import ClientProfilePicker from './client-profile-picker.vue';
import type { ClientProfile, ClientProfileId } from '../shared/client-profile.ts';

export type ClientProfilePickerResult = {
  readonly type: 'create';
  readonly name: string;
} | {
  readonly type: 'select';
  readonly profileId: ClientProfileId;
};

export interface ClientProfilePickerOptions {
  readonly title?: string;
  readonly currentProfileId?: ClientProfileId;
}

export function showClientProfilePicker(
  profiles: readonly ClientProfile[],
  options: ClientProfilePickerOptions = {},
): Promise<ClientProfilePickerResult | undefined> {
  const host = document.createElement('div');
  document.body.append(host);

  return new Promise((resolve) => {
    const app = createApp(ClientProfilePicker, {
      title: options.title,
      profiles,
      currentProfileId: options.currentProfileId,
      onCancel: () => {
        cleanup(undefined);
      },
      onCreate: (name: string) => {
        cleanup({
          type: 'create',
          name,
        });
      },
      onSelect: (profileId: ClientProfileId) => {
        cleanup({
          type: 'select',
          profileId,
        });
      },
    });
    app.mount(host);

    function cleanup(result: ClientProfilePickerResult | undefined) {
      app.unmount();
      host.remove();
      resolve(result);
    }
  });
}
