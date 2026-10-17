export type PlatformAdminLike = {
	revokedAt: Date | null;
	expiresAt: Date | null;
};

export function isPlatformAdminActive(row: PlatformAdminLike, now: Date = new Date()): boolean {
	if (row.revokedAt) return false;
	if (row.expiresAt) return row.expiresAt > now;
	return true;
}
