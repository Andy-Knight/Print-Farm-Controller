# In-app Kubernetes upgrades

The example single-replica K3s/Kubernetes Deployment includes the updater settings. Install its separate updater resources first. Custom installations can enable the updater with the patch below. The existing data and log PVCs remain attached across the replacement. The interface briefly disconnects while Kubernetes recreates the pod.

## New installations

The [controller Deployment](../deploy/kubernetes/print-farm-controller.yaml) includes the requester service account, token mounting and upgrade environment variable. Both example Deployments use versioned images. Select your approved image versions, configure storage and networking for your cluster, and apply the updater resources before the controller. From the repository root, using namespace `pfc`, run the following commands.

```sh
kubectl create namespace pfc
kubectl -n pfc apply -f deploy/kubernetes/controller-upgrades.yaml
kubectl -n pfc apply -f deploy/kubernetes/print-farm-controller.yaml
kubectl -n pfc rollout status deployment/print-farm-controller
```

Use your existing namespace if it has already been created. The new-install Deployment already contains the settings from `enable-upgrades.json`.

## Enable upgrades on existing installations

1. In the controller's namespace, apply [controller-upgrades.yaml](../deploy/kubernetes/controller-upgrades.yaml). Pin the updater Deployment to a published controller image that includes the updater worker.
2. Pin the existing controller image to a full published version or immutable digest. Keep the controller Deployment named `print-farm-controller`, its container named `controller`, replicas at one, and the strategy set to `Recreate`.
3. Apply [enable-upgrades.json](../deploy/kubernetes/enable-upgrades.json) as a strategic merge patch to the controller Deployment. It sets one replica, the `Recreate` strategy, the requester service account, token mounting and `PFC_KUBERNETES_UPGRADES=1` on the `controller` container. Configure the controller image pin in step 2 separately.
4. Deploy the updated configuration. The requester can only read and update its named upgrade ConfigMap. The separate updater can also read and patch the named controller Deployment. Network policy must allow both workloads to reach the Kubernetes API and GHCR over HTTPS.

If GitOps manages the image field, use its normal upgrade flow or configure it to allow image updates from this updater. Otherwise it can revert the selected image.

From the repository root, run the following commands when the farm is idle. This example uses namespace `pfc`. Substitute the namespace used by your installation. Pin the updater image in `controller-upgrades.yaml` before applying it, and confirm the controller image uses a full version or digest. Applying the patch restarts the controller and briefly interrupts access.

```sh
kubectl -n pfc apply -f deploy/kubernetes/controller-upgrades.yaml
kubectl -n pfc patch deployment print-farm-controller --type=strategic --patch-file deploy/kubernetes/enable-upgrades.json
kubectl -n pfc rollout status deployment/print-farm-controller
```

The patch targets the repository's `print-farm-controller` Deployment and its `controller` container. Custom deployments must match these names for the updater to manage them. Keep the equivalent configuration in your deployment source so later redeployments retain upgrade support.

## Upgrade button unavailable

Finding an image confirms access to GHCR. Enabling upgrades also requires the optional updater configuration above. When a newer container image is available, Software updates shows administrators a disabled **Upgrade container** action with setup instructions if upgrades are disabled, or a connection message if upgrade status cannot be read. Builds through v0.68.2 hide the action in these cases.

In the controller's namespace, inspect the controller Deployment's environment and service account, confirm that ConfigMap `print-farm-controller-upgrade` exists, and check the `print-farm-controller-updater` Deployment and its logs. The administrator-only `GET /api/controller-upgrade` returns `enabled:false` when the controller upgrade feature is disabled. A failed request can indicate missing ConfigMap permissions or Kubernetes API connectivity. After correcting deployment configuration, reopen Software updates and choose **Check for updates**.

## Run an upgrade

Sign in as an administrator and open **Users & settings → Software updates**. Choose **Check for updates**, then **Upgrade container**, and confirm the published image shown. Finish active jobs, uploads and backups before starting. The controller pauses queue dispatch and blocks new work while the request is pending. Avoid starting jobs directly on a printer during this interval.

The updater resolves the selected version to a GHCR digest and changes only the controller container's image. It records the previous image and checks the Deployment reaches one available replica using the new image. Reopen **Software updates** after reconnecting to see the result. Rollout status survives a controller restart in the ConfigMap.

If the replacement does not become ready within ten minutes, the updater records a failure. If the UI is unavailable, inspect the Deployment and the `data.upgrade` field on ConfigMap `print-farm-controller-upgrade`. The recorded previous image is available for manual recovery. Review data compatibility and backups before rolling back. If the optional updater has lost access to the ConfigMap, restore that access before continuing production.
