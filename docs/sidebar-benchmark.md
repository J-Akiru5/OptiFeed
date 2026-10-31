# Sidebar benchmark — desktop collapse behaviour

Issue: [#297](https://github.com/J-Akiru5/optifeed/issues/297). Scope: the three desktop
sidebars (`components/sidebar.tsx`, `components/admin-sidebar.tsx`,
`components/superadmin-sidebar.tsx`). Mobile navigation is unchanged.

## What production systems do

| System | Expanded width | Collapse behaviour | Tooltips | Persistence | Mobile |
| --- | --- | --- | --- | --- | --- |
| [Linear](https://linear.app/changelog/unpublished-collapsible-sidebar) | ≈220 px (unofficial) | Fully hides; no icon rail. `[`, the sidebar border, the top-left control, or the command menu collapses it. | No icon rail; normal tooltips. | Sidebar sections persist ([2019 changelog](https://linear.app/changelog/2019-11-11-new-sidebar)); whole-sidebar persistence is not documented. | Not documented. |
| [Vercel](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) | Resizable; default not documented (≈240 px unofficial) | Hides entirely. The 2026 navigation redesign made the sidebar resizable and hideable rather than an icon rail. | Not applicable while hidden. | Not documented. | Floating bottom bar for one-handed use (documented). |
| [Stripe](https://docs.stripe.com/dashboard/basics) | ≈240 px (unofficial) | Persistent primary sidebar; the dashboard docs describe no collapse-to-rail control. | Labels stay visible. | Not applicable. | Dedicated [mobile app](https://docs.stripe.com/dashboard/mobile); the web dashboard keeps the full sidebar. |
| [Notion](https://www.notion.com/help/navigate-with-the-sidebar) | Resizable; default not documented (≈240 px unofficial) | Fully hides; no icon rail. Click `<<`/`>>` or press `Cmd/Ctrl + \`. | No icon rail; normal tooltips. | Not documented. | Not documented in the sidebar article. |
| [GitHub](https://github.blog/changelog/2023-04-05-redesigned-navigation-available-in-public-beta/) | No persistent left rail | Global navigation is a top bar plus a site-wide menu opened by the hamburger button; there is nothing to collapse. | Top-bar icon controls have accessible names/tooltips. | Not applicable. | Responsive top navigation and menu (documented). |

Two reference implementations fill in the details the consumer apps do not publish:

- **VS Code** uses a 48 px Activity Bar next to a 300 px default Primary Side Bar, and toggles the
  side bar with `Ctrl/Cmd + B` ([layout docs](https://code.visualstudio.com/docs/configure/custom-layout),
  [activity bar constants](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/activitybar/activitybarPart.ts),
  [side bar default](https://github.com/microsoft/vscode/blob/main/src/vs/platform/theme/electron-main/themeMainServiceImpl.ts)).
- **shadcn/ui** ships `16rem` (256 px) expanded, `18rem` mobile, and `icon`/`offcanvas`/`none`
  collapse modes with a `Cmd/Ctrl + B` shortcut
  ([sidebar docs](https://ui.shadcn.com/docs/components/sidebar)).

Vendors rarely publish sidebar widths. "Unofficial" values are approximations from public product
screenshots and should be read as a 220–260 px range, not a spec; only VS Code and shadcn publish
exact constants in the sources above. "Not documented" means the vendor documentation reviewed for
this issue does not state the behaviour.

## Decisions for OptiFeed

1. **Collapse to an icon rail, not a full hide.** The three consoles are the primary way to switch
   tasks, so keeping every destination one click away beats reclaiming the full 256 px. Linear,
   Vercel and Notion choose a full hide; VS Code and shadcn's `icon` mode show the rail pattern
   working at this density.
2. **256 px expanded, 76 px collapsed.** Expanded keeps the current `w-64` (also shadcn's 16 rem
   default). Collapsed is 76 px: 12 px rail padding on each side plus a 52 px item, which still
   leaves a 44 px target with 8 px slack. VS Code's 48 px rail works because its items fill the
   rail width; OptiFeed keeps rounded active pills, so 76 px preserves the existing active
   indicator and 44 px touch target.
3. **Native tooltips plus accessible names.** Collapsed links get `title` and `aria-label`; their
   text stays in the DOM as `sr-only`, so the accessible name and tab order survive. A custom
   portal tooltip was rejected: the rail scrolls (`overflow-y-auto`), so a right-side tooltip would
   be clipped, and a portal would add positioning code for no navigation benefit. `title` is
   hover-only; keyboard users get the same name through `aria-label`.
4. **One shared preference in `localStorage`.** Key `optifeed:sidebar-collapsed` (`"1"`/`"0"`) is
   shared by all three consoles, so a reader who prefers the rail gets it everywhere. A failed
   read/write (private mode, quota) falls back to expanded for the visit. A `storage` listener keeps
   open tabs in step.
5. **Hydrate without an SSR mismatch.** Server and hydration render expanded, which matches the
   SSR markup. The stored value is read in a layout effect, flushed before the browser paints the
   hydrated commit. Width/padding transitions are enabled only after mount, so the first correction
   is instant rather than an animated slide.
6. **Toggle at the bottom of the rail.** A native `<button>` with `aria-label`, `aria-expanded`,
   `aria-controls` pointing at the sidebar `<nav>`, a 44 px minimum height and the existing focus
   ring. It stays visible in both states and reads "Collapse sidebar" / "Expand sidebar".
7. **Preserve existing navigation semantics.** Active-route matching, `aria-current="page"`,
   permissions, the farmer hopper card, the admin "back to dashboard" link and superadmin sign-out
   are unchanged. In the rail the hopper card becomes a compact icon-plus-percentage link to the
   same hopper chart; the other bottom actions become icon-only with labels kept for assistive
   technology. Active `translate-x` is applied only when expanded.
8. **No mobile change.** Each aside is already `hidden lg:flex`; the existing bottom navigation
   remains the mobile surface. The toggle is desktop-only because it lives inside the aside.
9. **No page-layout change.** Each aside is a flex child next to `main` (`flex-1 min-w-0`), so the
   content reflows automatically when the rail width changes.

## Residual risks / not done

- A cold page load paints the server-rendered expanded sidebar until hydration runs. The layout
  effect prevents a second visible jump after hydration, but a truly flash-free first paint would
  need the state in a cookie or a blocking inline script. The app's Report-Only CSP disallows inline
  scripts, and changing the layouts was outside this issue's scope.
- Native `title` tooltips do not appear on keyboard focus. The accessible name is still announced,
  but there is no visible focus tooltip.
- No global keyboard shortcut (`Cmd/Ctrl + B` or `[`) was added; scope was the visible control only.
- Widths for Linear, Vercel, Stripe and Notion are observations, not documented constants.
