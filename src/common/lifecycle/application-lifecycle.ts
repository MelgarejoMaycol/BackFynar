export interface ApplicationLifecycle {
  isShuttingDown(): boolean;
}

let applicationShuttingDown = false;

export const applicationLifecycle: ApplicationLifecycle = {
  isShuttingDown: () => applicationShuttingDown,
};

export function markApplicationShuttingDown(): void {
  applicationShuttingDown = true;
}

export function resetApplicationLifecycle(): void {
  applicationShuttingDown = false;
}
