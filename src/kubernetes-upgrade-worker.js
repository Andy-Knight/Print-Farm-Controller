import { setTimeout } from 'node:timers/promises';
import { inClusterUpgradeClient, reconcileUpgrade, resolvePublishedImage } from './kubernetes-upgrade.js';

const client = await inClusterUpgradeClient();
while (true) {
  try {
    await reconcileUpgrade(client, {resolveImage:resolvePublishedImage});
  } catch (error) {
    if (error.kubeStatus !== 409) console.warn('Controller upgrade reconciliation:', error.message);
  }
  await setTimeout(3000);
}
