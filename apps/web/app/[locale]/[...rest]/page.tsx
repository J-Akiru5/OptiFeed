import { notFound } from "next/navigation";

/**
 * Feeds unknown locale-prefixed paths into `app/[locale]/not-found.tsx` (#761).
 *
 * Without a catch-all, Next renders its default English 404 for URLs such as
 * `/hil/this-page-does-not-exist`. Static and dynamic routes win over this
 * segment, so only genuinely unmatched paths reach it.
 */
export default function CatchAllPage() {
	notFound();
}
