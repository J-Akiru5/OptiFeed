import type { ReactElement } from "react";

/**
 * Render a React tree to the HTML a browser receives on first paint.
 *
 * `renderToStaticMarkup` stops at the first Suspense boundary, so a page whose
 * charts are split through `components/charts/lazy` comes back as skeletons and
 * a test asserting chart content would fail for the wrong reason. The streaming
 * renderer waits for every boundary (`allReady`) and is therefore the honest
 * "what does the page send" assertion for those pages.
 *
 * The resolved content arrives in hidden `<div id="S:n">` nodes alongside the
 * skeletons, which is exactly what the browser receives before hydration, so
 * `toContain` assertions keep working unchanged.
 */
export async function renderPageHtml(element: ReactElement): Promise<string> {
	const { renderToReadableStream } = await import("react-dom/server");
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}
