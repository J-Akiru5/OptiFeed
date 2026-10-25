"use client";

import { saveOfflineSnapshot } from "@/lib/offline/db";
import type { OfflinePage } from "@/lib/offline/snapshots";
import { useEffect } from "react";

interface SnapshotWriterProps {
	page: OfflinePage;
	scope: string;
	pondId: string;
	pondName: string;
	data: unknown;
	active?: boolean;
}

/**
 * Writes the compact page snapshot used by the static offline shell. Rendering
 * it is intentionally invisible; it runs after hydration and is best-effort.
 */
export function SnapshotWriter({
	page,
	scope,
	pondId,
	pondName,
	data,
	active = true,
}: SnapshotWriterProps) {
	const serialized = JSON.stringify(data);

	useEffect(() => {
		try {
			void saveOfflineSnapshot({
				page,
				scope,
				pondId,
				pondName,
				data: JSON.parse(serialized) as unknown,
				active,
			});
		} catch {
			// Offline snapshots must never break the online page.
		}
	}, [page, scope, pondId, pondName, active, serialized]);

	return null;
}
