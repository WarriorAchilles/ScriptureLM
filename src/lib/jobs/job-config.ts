/** Max per-job execution attempts before marking the job (and ingest failures: the source) as failed. */
export function getJobMaxAttempts(): number {
  const raw = process.env.JOB_MAX_ATTEMPTS?.trim();
  if (!raw) {
    return 3;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }
  return parsed;
}

export function getWorkerPollIntervalMs(): number {
  const raw = process.env.WORKER_POLL_INTERVAL_MS?.trim();
  if (!raw) {
    return 3000;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 200) {
    return 3000;
  }
  return parsed;
}
