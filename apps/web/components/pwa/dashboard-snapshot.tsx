"use client";

import { type DashboardSnapshotInput, writeDashboardSnapshot } from "@/lib/pwa/snapshot";
import { useEffect } from "react";

export function DashboardSnapshot({ snapshot }: { snapshot: DashboardSnapshotInput }) {
	useEffect(() => {
		writeDashboardSnapshot(snapshot);
	}, [snapshot]);

	return null;
}
