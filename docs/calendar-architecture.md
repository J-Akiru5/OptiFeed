# Calendar architecture

Issue #298. Every calendar in the app is built from one shared shell so the
farmer, tenant-admin and platform calendars render the same layout, the same
viewport behaviour and the same side pane.

## Components

| Piece | File | Responsibility |
| --- | --- | --- |
| `CalendarView` | `apps/web/components/harvest/calendar-view.tsx` | The only FullCalendar wrapper (plugins, toolbar copy, event mapping, drag/resize/select, event chips). |
| `CalendarPageShell` | `apps/web/components/calendar/calendar-shell.tsx` | Page root: full-viewport column above `xl`, normal scrolling page below it. Holds the page header. |
| `CalendarWorkbench` | `apps/web/components/calendar/calendar-shell.tsx` | Grid + side pane: stacked below `xl`, two columns above it. |
| `CalendarSurface` | `apps/web/components/calendar/calendar-shell.tsx` | The calendar card: fixed toolbar, body that owns the remaining height, loading bar. |
| `CalendarSidePane` | `apps/web/components/calendar/calendar-shell.tsx` | The only scrolling region above `xl`. |
| `CalendarSidePanel` | `apps/web/components/calendar/calendar-shell.tsx` | A content-height card inside the side pane. |

`calendar-shell.tsx` has no `"use client"` and no hooks. It is imported by server
pages (`CalendarPageShell`) and by the two client calendar components
(`CalendarWorkbench`, `CalendarSurface`, `CalendarSidePane`, `CalendarSidePanel`).

## Viewport contract

Above `xl` a calendar page is exactly one viewport tall. The page itself never
scrolls; only the side pane does.

```
<html> viewport (100dvh)
└── app <header>                       4rem (layouts)
    └── <main> .ofd-main               padding 2rem top / 2rem bottom
        └── CalendarPageShell          h-[calc(100dvh-8rem)]  overflow-hidden
            ├── header slot            flex-none
            └── body slot              min-h-0 flex-1 flex-col
                └── CalendarWorkbench  min-h-0 flex-1 row
                    ├── CalendarSurface    min-h-0 flex-1 flex-col
                    │   ├── toolbar       flex-none
                    │   └── body          min-h-0 flex-1
                    │       └── viewport  h-[62vh] -> xl:h-full
                    │           └── CalendarView  height="100%"
                    └── CalendarSidePane  min-h-0, overflow-y-auto
```

Rules that make the chain work:

1. Every flex ancestor between the viewport and the grid is `min-h-0`, otherwise
   the grid's intrinsic height wins and the document grows a scrollbar.
2. The height is a definite `calc()`, not `h-full`: `main` is not itself a
   height-constrained flex container.
3. `CalendarSurface`'s toolbar is `flex-none`; only the body flexes, so a filter
   row can wrap without pushing the grid out of the viewport.
4. `CalendarView` keeps `height="100%"`; `.harvest-calendar` in
   `harvest-calendar.css` is `height: 100%`, and `CalendarSurface` gives it a
   definite parent height at every breakpoint.

### Breakpoints

- **Below `xl`** the page keeps the ordinary document flow. The grid uses
  `h-[62vh] min-h-[420px]`, the side pane is a normal stacked card, and nothing
  becomes a nested scroll container.
- **From `xl`** the shell is `xl:h-[calc(100dvh-8rem)] xl:overflow-hidden`, the
  workbench is a row, and `CalendarSidePane` is `xl:overflow-y-auto`.

### Extra page chrome above the shell

`CalendarPageShell` sizes itself against the app header plus the dashboard
`main` padding (8rem). If a page has chrome rendered by its layout before the
shell, the shell would overflow by that amount. `/dashboard/calendar` has the
dashboard layout's global "Back to dashboard" link (2.25rem), so that page
passes `reserveBackLink`, which subtracts 10.25rem instead.

The layout's announcement banner can add height above any page (including the
control room). Because it is rendered outside the page, a page with an active
announcement can still scroll by the banner height.

## Pages covered

| Page | Calendar component | Header passed to the shell |
| --- | --- | --- |
| `/dashboard/calendar` | `HarvestCalendar` (`components/harvest/harvest-calendar.tsx`) | `DashboardPageHeader` + `ReadOnlyNotice`, `reserveBackLink` |
| `/admin/calendar` | `HarvestCalendar` | `AdminPageHeader` |
| `/superadmin/calendar` | `PlatformCalendar` (`components/superadmin/platform-calendar.tsx`) | `PageHeader` |

The old `/dashboard/harvest` route redirects to `/dashboard/calendar`; it has no
separate calendar view.

## Adding another calendar view

1. Render the page inside `CalendarPageShell` and pass the page header through
   the `header` prop.
2. Build the grid with `CalendarWorkbench` + `CalendarSurface` (label, toolbar,
   `busy`, children) and the right rail with `CalendarSidePane` +
   `CalendarSidePanel`.
3. Render `CalendarView` inside `CalendarSurface`; do not add another height
   wrapper or another FullCalendar instance.
4. Keep the page header, filters, permissions and CRUD inside the components —
   the shell only owns layout.

## What did not change

- Calendar data and API contracts (`/api/calendar/events`,
  `/api/platform/calendar/events`) are untouched.
- Event CRUD, drag/drop, resize, task toggles and the read-only rules stay in
  `HarvestCalendar` / `PlatformCalendar`.
- `CalendarView`'s FullCalendar configuration is unchanged apart from living in
  the shared surface.

## FullCalendar sizing notes

- Month view is constrained to the body by FullCalendar's `height="100%"`; the
  grid keeps its own month layout inside that box and the surface clips the
  overflow instead of growing the page.
- Week/day views use FullCalendar's own time-grid scroll area. That is internal
  to the grid, not a page or pane scroll trap.
- List/agenda views fill the same body and scroll inside FullCalendar.
- The grid must never be given `h-auto`/`min-h-[420px]` at `xl`; `xl:min-h-0`
  on the viewport wrapper is what lets it shrink to short desktop viewports.
- `expandRows` is not enabled, so a month with five weeks keeps its natural row
  heights and may leave spare space at the bottom of a tall surface. Add it to
  the `dayGridMonth` view in `CalendarView` if that space should be absorbed.
