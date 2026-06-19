/**
 * Stats — Ianus Liminalis
 *
 * Tracker globale per statistiche in tempo reale del server MCP.
 * Usato dalla resource `ianus://stats` e dai tool per incrementare il contatore.
 */

export const stats = {
  startTime: Date.now(),
  totalOperations: 0,

  increment(): void {
    this.totalOperations++;
  },

  getUptime(): string {
    const elapsed = Date.now() - this.startTime;
    // Formatta come HH:MM:SS
    const totalSeconds = Math.floor(elapsed / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((n) => String(n).padStart(2, '0'))
      .join(':') + 's';
  },

  toJSON() {
    return {
      uptime: this.getUptime(),
      totalOperations: this.totalOperations,
      toolsRegistered: 59,
      permissionVersion: 1,
      workspaceRoot: '',
    };
  },
};
