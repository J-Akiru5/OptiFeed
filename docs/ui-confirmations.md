# Action confirmations

Every mutating action must confirm itself on screen. PakaonAI uses **Sonner** for that confirmation.

## The standard

- The `Toaster` lives once in `apps/web/app/[locale]/layout.tsx`, at the **top-right** with `richColors`.
- A successful action calls `toast.success(<translated message>)`.
- A failed server action calls `toast.error(<translated message>)` and keeps the inline explanation where the form already provides one.
- Client-side validation keeps its inline error (for example, “Passwords do not match.”). It does not need a duplicate toast.
- Do not use `alert()` or `confirm()` for routine actions. Destructive actions can use an in-page confirmation dialog first, then a success/error toast after the action completes.
- Toast text comes from the active locale’s messages, so it switches with the language dropdown.

## Covered today

| Area | Confirmation |
| --- | --- |
| Change password | Inline success plus top-right `password.updated` toast; server errors also toast |
| Forced password change | Toast fires before the client-side redirect, and the root Toaster keeps it visible |
| Profile photo | Upload/save/remove success and error toasts |
| Notification preferences | Save/error toasts |
| Feeder controls, schedule, calibration, harvest, growth, import/export, admin/member settings | Existing Sonner success/error toasts |

## Change-password example

```tsx
import { toast } from "sonner";

const result = await changeOwnPassword({ currentPassword, newPassword });

if ("error" in result) {
	const message = t("service");
	setError(message);
	toast.error(message);
	return;
}

toast.success(t("updated"));

if (forced) {
	router.replace(result.redirectTo);
	return;
}
```

The form still renders the inline `password.updated` output; the toast is the consistent, screen-level confirmation the issue asked for. Because the `Toaster` is mounted in the locale layout, the toast survives the client-side redirect after a forced change.

## Adding a new action

1. Call the server action from the component or form.
2. On success: `toast.success(t("...saved"))`.
3. On failure: `toast.error(t("...error"))` and keep a field-level message if the form needs one.
4. Add the message key to `en.json` (and `hil.json`, `tl.json` when translated).
5. Verify the toast appears in the top-right on both desktop and mobile, in light and dark mode.

## Scope note

This document and the #288 change only touch UI confirmation behavior. They do not change `package.json`, `VERSION`, tags or `CHANGELOG.md`; release versioning stays with the active release/integration agent.
