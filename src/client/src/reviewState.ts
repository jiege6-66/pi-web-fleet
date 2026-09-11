const ROLLED_BACK_STORAGE_KEY = "pi-web:rolled-back-review-snapshots";

const rolledBackSnapshots = new Set<string>();
let storageLoaded = false;

function loadRolledBackFromStorage(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(ROLLED_BACK_STORAGE_KEY);
    if (raw === null || raw === "") return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string") rolledBackSnapshots.add(item);
      }
    }
  } catch {
    // Ignore storage parse errors
  }
}

function saveRolledBackToStorage(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ROLLED_BACK_STORAGE_KEY, JSON.stringify([...rolledBackSnapshots]));
  } catch {
    // Ignore storage quota errors
  }
}

export function isSnapshotRolledBack(snapshotId: string): boolean {
  loadRolledBackFromStorage();
  return rolledBackSnapshots.has(snapshotId);
}

export function recordRolledBackSnapshot(snapshotId: string): void {
  loadRolledBackFromStorage();
  rolledBackSnapshots.add(snapshotId);
  saveRolledBackToStorage();
}

export function clearRolledBackSnapshotsForTest(): void {
  rolledBackSnapshots.clear();
  storageLoaded = false;
}
