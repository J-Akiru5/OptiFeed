"use client";

import type { DashboardAlert } from "@/lib/dashboard/alerts";
import type { DeviceHealthView } from "@/lib/device-health-model";
import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

/**
 * The dashboard page owns its alert data; the shared shell displays it (#819).
 *
 * The sidebar lives in `(dashboard)/layout.tsx`, which is shared by every
 * farmer console route. Recomputing the dashboard's alerts there would add the
 * recalibration and 7-day drift reads to History, Schedule and Settings. The
 * page already has those reads, so it publishes the finished strings and the
 * device-health view into this provider and the sidebar renders them. The
 * sidebar also gates on the pathname, so no other console page shows the
 * dashboard's footer.
 *
 * `synced` separates "the page has not published yet" from "the page has
 * published an all-clear". Without it the sidebar would briefly claim there is
 * nothing to do while the dashboard's alerts were still arriving.
 */
export interface DashboardAlertsSnapshot {
	alerts: readonly DashboardAlert[];
	health: DeviceHealthView | null;
	/** Where the health card's "open hardware settings" link goes. */
	hardwareHref: string | null;
	synced: boolean;
}

const EMPTY_SNAPSHOT: DashboardAlertsSnapshot = {
	alerts: [],
	health: null,
	hardwareHref: null,
	synced: false,
};

interface DashboardAlertsContextValue {
	snapshot: DashboardAlertsSnapshot;
	setSnapshot: Dispatch<SetStateAction<DashboardAlertsSnapshot>>;
}

const DashboardAlertsContext = createContext<DashboardAlertsContextValue | null>(null);

/** A no-op fallback keeps the sidebar renderable in isolation (tests, stories). */
const FALLBACK_CONTEXT: DashboardAlertsContextValue = {
	snapshot: EMPTY_SNAPSHOT,
	setSnapshot: () => undefined,
};

export function DashboardAlertsProvider({ children }: { children: ReactNode }) {
	const [snapshot, setSnapshot] = useState<DashboardAlertsSnapshot>(EMPTY_SNAPSHOT);
	const value = useMemo(() => ({ snapshot, setSnapshot }), [snapshot]);

	return (
		<DashboardAlertsContext.Provider value={value}>{children}</DashboardAlertsContext.Provider>
	);
}

export function useDashboardAlerts(): DashboardAlertsContextValue {
	return useContext(DashboardAlertsContext) ?? FALLBACK_CONTEXT;
}

export interface DashboardAlertsSyncProps {
	alerts: readonly DashboardAlert[];
	health: DeviceHealthView | null;
	hardwareHref: string | null;
}

/**
 * Rendered by the dashboard page. It publishes after mount and clears on
 * unmount, so navigating to another console route cannot leave stale alerts
 * behind. The alert list is display data; nothing here fetches or authorizes.
 */
export function DashboardAlertsSync({ alerts, health, hardwareHref }: DashboardAlertsSyncProps) {
	const { setSnapshot } = useDashboardAlerts();

	useEffect(() => {
		setSnapshot({ alerts, health, hardwareHref, synced: true });
	}, [alerts, health, hardwareHref, setSnapshot]);

	useEffect(() => {
		return () => setSnapshot(EMPTY_SNAPSHOT);
	}, [setSnapshot]);

	return null;
}
