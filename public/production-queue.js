export const productionQueueViews = Object.freeze({
  queued:'Queued jobs',
  oldest:'Oldest queued job',
  blocked:'Jobs blocked',
  clearance:'Beds to clear'
});

export function productionQueueSnapshot(queue, group) {
  const members = new Set(group?.printerIds);
  const pending = (queue.jobs || []).filter(job =>
    (job.status === 'queued' || job.status === 'needs_review') &&
    (!group || (job.groupId ? job.groupId === group.id : members.has(job.printerId))));
  const beds = (queue.bedClearance || []).filter(item => !group || members.has(item.printerId));
  let oldest = null;
  let oldestTime = Infinity;
  let oldestBedTime = Infinity;
  for (const job of pending) {
    const queuedAt = Date.parse(job.queuedAt);
    if (queuedAt < oldestTime) {
      oldest = job;
      oldestTime = queuedAt;
    }
  }
  for (const bed of beds) {
    const finishedAt = Date.parse(bed.finishedAt);
    if (finishedAt < oldestBedTime) oldestBedTime = finishedAt;
  }
  return { pending, oldest, oldestTime, oldestBedTime, beds, blocked:pending.filter(job => job.waitingReason) };
}

export function productionQueueSearch(view, groupId) {
  const params = new URLSearchParams({ view });
  if (groupId) params.set('group', groupId);
  return `?${params}`;
}
