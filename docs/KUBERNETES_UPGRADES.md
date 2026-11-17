# In-app Kubernetes upgrades

Use the optional updater with the example single-replica K3s/Kubernetes Deployment. The existing data and log PVCs remain attached across the replacement. The interface briefly disconnects while Kubernetes recreates the pod.

## Enable upgrades

1. In the controller's namespace, apply [controller-upgrades.yaml](../deploy/kubernetes/controller-upgrades.yaml). Pin the updater Deployment to a published controller image that includes the updater worker.
2. Pin the existing controller image to a full published version or immutable digest. Keep the controller Deployment named `print-farm-controller`, its container named `controller`, replicas at one, and the strategy set to `Recreate`.
3. In the controller Deployment's pod spec, set `serviceAccountName: print-farm-controller-upgrade-requester` and `automountServiceAccountToken: true`. Add the environment variable `PFC_KUBERNETES_UPGRADES` with value `"1"` to the controller container.
4. Deploy the updated configuration. The requester can only read and update its named upgrade ConfigMap. The separate updater can also read and patch the named controller Deployment. Network policy must allow both workloads to reach the Kubernetes API and GHCR over HTTPS.

If GitOps manages the image field, use its normal upgrade flow or configure it to allow image updates from this updater. Otherwise it can revert the selected image.

## Run an upgrade

Sign in as an administrator and open **Users & settings → Software updates**. Choose **Check for updates**, then **Upgrade container**, and confirm the published image shown. Finish active jobs, uploads and backups before starting. The controller pauses queue dispatch and blocks new work while the request is pending. Avoid starting jobs directly on a printer during this interval.

The updater resolves the selected version to a GHCR digest and changes only the controller container's image. It records the previous image and checks the Deployment reaches one available replica using the new image. Reopen **Software updates** after reconnecting to see the result. Rollout status survives a controller restart in the ConfigMap.

If the replacement does not become ready within ten minutes, the updater records a failure. If the UI is unavailable, inspect the Deployment and the `data.upgrade` field on ConfigMap `print-farm-controller-upgrade`. The recorded previous image is available for manual recovery. Review data compatibility and backups before rolling back. If the optional updater has lost access to the ConfigMap, restore that access before continuing production.
