import {
	farmDateTimeToUtcDate,
	isCalendarDateTimeValue,
	isDateOnlyValue,
} from "@/lib/calendar/datetime";
import { z } from "zod";
import { daysBetween, isValidDateOnly, todayDateOnly } from "./dates";

export const dateOnlySchema = z
	.string()
	.refine(isValidDateOnly, "Use a valid date in YYYY-MM-DD format");

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform((value) => (value && value.length > 0 ? value : null));

export const cropCycleInputSchema = z
	.object({
		pondId: z.string().min(1, "Choose a pond"),
		label: optionalText(64),
		stockingDate: dateOnlySchema,
		stockingCount: z
			.number("Stocking count must be a number")
			.int("Stocking count must be a whole number")
			.min(1, "Stocking count must be at least 1")
			.max(1_000_000, "Stocking count is too large"),
		stockingAvgWeightG: z
			.number("Stocking weight must be a number")
			.positive("Stocking weight must be greater than 0")
			.max(10_000, "Stocking weight is too large")
			.nullish(),
		growOutDays: z
			.number("Grow-out days must be a number")
			.int("Grow-out days must be a whole number")
			.min(30, "Grow-out period must be at least 30 days")
			.max(365, "Grow-out period cannot exceed 365 days"),
		targetHarvestDate: dateOnlySchema,
		targetHarvestWeightG: z
			.number("Target weight must be a number")
			.positive("Target weight must be greater than 0")
			.max(10_000, "Target weight is too large")
			.nullish(),
		expectedSurvivalPct: z
			.number("Survival must be a number")
			.min(1, "Survival must be at least 1%")
			.max(100, "Survival cannot exceed 100%")
			.nullish(),
		notes: optionalText(1_000),
	})
	.superRefine((value, ctx) => {
		// Field-level date validation already failed; do not call Temporal on
		// an impossible date (2026-02-30) or it throws instead of returning a
		// normal Zod failure.
		if (!isValidDateOnly(value.stockingDate) || !isValidDateOnly(value.targetHarvestDate)) {
			return;
		}
		const today = todayDateOnly();
		if (daysBetween(value.stockingDate, today) < -7) {
			ctx.addIssue({
				code: "custom",
				path: ["stockingDate"],
				message: "Stocking date cannot be more than 7 days in the future",
			});
		}
		const span = daysBetween(value.stockingDate, value.targetHarvestDate);
		if (span < 30) {
			ctx.addIssue({
				code: "custom",
				path: ["targetHarvestDate"],
				message: "Harvest date must be at least 30 days after stocking",
			});
		}
		if (span > 365) {
			ctx.addIssue({
				code: "custom",
				path: ["targetHarvestDate"],
				message: "Harvest date cannot be more than 365 days after stocking",
			});
		}
	});

export const harvestInputSchema = z
	.object({
		pondId: z.string().min(1),
		cycleId: z.string().min(1),
		actualHarvestDate: dateOnlySchema,
		actualHarvestWeightKg: z
			.number("Harvest weight must be a number")
			.positive("Harvest weight must be greater than 0")
			.max(100_000, "Harvest weight is too large"),
		actualHarvestCount: z
			.number("Harvest count must be a number")
			.int("Harvest count must be a whole number")
			.min(0, "Harvest count cannot be negative")
			.max(1_000_000, "Harvest count is too large"),
		actualFcr: z
			.number("FCR must be a number")
			.min(0.5, "FCR must be at least 0.5")
			.max(10, "FCR cannot exceed 10")
			.nullish(),
		notes: optionalText(1_000),
	})
	.superRefine((value, ctx) => {
		if (!isValidDateOnly(value.actualHarvestDate)) return;
		if (daysBetween(value.actualHarvestDate, todayDateOnly()) < 0) {
			ctx.addIssue({
				code: "custom",
				path: ["actualHarvestDate"],
				message: "Harvest date cannot be in the future",
			});
		}
	});

export const manualEventTypes = [
	"MAINTENANCE",
	"SAMPLING",
	"HARVEST_PLANNED",
	"STOCKING",
	"OTHER",
] as const;

export const pondItemKinds = ["EVENT", "TASK"] as const;
export const recurrenceFrequencies = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export const eventReminderMinutes = [60, 1440] as const;

const eventColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour");

const calendarMomentSchema = z
	.string()
	.refine(isCalendarDateTimeValue, "Use a valid date or date-time");

const patchText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform((value) =>
			value === undefined ? undefined : value && value.length > 0 ? value : null,
		);

const recurrenceSchema = z
	.object({
		freq: z.enum(recurrenceFrequencies).nullish(),
		interval: z
			.number("Repeat interval must be a number")
			.int("Repeat interval must be a whole number")
			.min(1, "Repeat interval must be at least 1")
			.max(52, "Repeat interval cannot exceed 52")
			.nullish(),
		until: dateOnlySchema.nullish(),
	})
	.nullish();

const reminderMinutesSchema = z
	.array(z.union([z.literal(60), z.literal(1440)]))
	.transform((values) => [...new Set(values)].sort((a, b) => a - b));

/**
 * Event/Task fields shared by create and update. `startsAt` keeps its original
 * name for the existing move/resize call sites; it now accepts a date-only day
 * (all-day items) or a naive farm-local date-time (timed items).
 */
function refineCalendarMoment(
	value: {
		allDay?: boolean;
		startsAt?: string;
		endsAt?: string | null;
		reminderMinutes?: number[];
		recurrence?: {
			freq?: (typeof recurrenceFrequencies)[number] | null;
			until?: string | null;
		} | null;
	},
	ctx: z.RefinementCtx,
): void {
	if (value.startsAt !== undefined) {
		const dateOnly = isDateOnlyValue(value.startsAt);
		if (value.allDay === true && !dateOnly) {
			ctx.addIssue({
				code: "custom",
				path: ["startsAt"],
				message: "An all-day item needs a date, not a time",
			});
		}
		if (value.allDay === false && dateOnly) {
			ctx.addIssue({
				code: "custom",
				path: ["startsAt"],
				message: "A timed item needs a date and time",
			});
		}
	}
	if (value.startsAt !== undefined && value.endsAt) {
		const end = farmDateTimeToUtcDate(value.endsAt);
		const start = farmDateTimeToUtcDate(value.startsAt);
		if (end.getTime() < start.getTime()) {
			ctx.addIssue({
				code: "custom",
				path: ["endsAt"],
				message: "The end must be after the start",
			});
		}
	}
	if (
		value.startsAt !== undefined &&
		value.recurrence?.freq &&
		value.recurrence.until &&
		isValidDateOnly(value.recurrence.until) &&
		value.recurrence.until < value.startsAt.slice(0, 10)
	) {
		ctx.addIssue({
			code: "custom",
			path: ["recurrence", "until"],
			message: "The repeat end cannot be before the first occurrence",
		});
	}
}

export const pondEventInputSchema = z
	.object({
		pondId: z.string().min(1),
		cropCycleId: z.string().min(1).nullish(),
		kind: z.enum(pondItemKinds).default("EVENT"),
		type: z.enum(manualEventTypes).default("MAINTENANCE"),
		title: z.string().trim().min(1, "Add a title").max(80, "Title is too long"),
		allDay: z.boolean().default(true),
		startsAt: calendarMomentSchema,
		endsAt: calendarMomentSchema.nullish(),
		color: eventColorSchema.nullish(),
		recurrence: recurrenceSchema,
		reminderMinutes: reminderMinutesSchema.optional(),
		notes: optionalText(1_000),
	})
	.superRefine((value, ctx) => {
		refineCalendarMoment(value, ctx);
		if (isDateOnlyValue(value.startsAt)) {
			if (daysBetween(value.startsAt, todayDateOnly()) < -365) {
				ctx.addIssue({
					code: "custom",
					path: ["startsAt"],
					message: "Event date is too far in the future",
				});
			}
		}
	});

export const updatePondEventSchema = z
	.object({
		id: z.string().min(1),
		kind: z.enum(pondItemKinds).optional(),
		type: z.enum(manualEventTypes).optional(),
		title: z.string().trim().min(1, "Add a title").max(80, "Title is too long").optional(),
		allDay: z.boolean().optional(),
		startsAt: calendarMomentSchema.optional(),
		endsAt: calendarMomentSchema.nullish(),
		color: eventColorSchema.nullish(),
		recurrence: recurrenceSchema,
		reminderMinutes: reminderMinutesSchema.optional(),
		notes: patchText(1_000),
	})
	.superRefine((value, ctx) => refineCalendarMoment(value, ctx));

export const completePondEventSchema = z.object({
	id: z.string().min(1),
	occurrence: z.string().datetime({ offset: true }).nullish(),
});

export const deletePondEventSchema = z.object({
	id: z.string().min(1),
	occurrence: z.string().datetime({ offset: true }).nullish(),
});

export const cancelCycleSchema = z.object({
	pondId: z.string().min(1),
	cycleId: z.string().min(1),
	notes: optionalText(1_000),
});

export type CropCycleInput = z.infer<typeof cropCycleInputSchema>;
export type HarvestInput = z.infer<typeof harvestInputSchema>;
export type PondEventInput = z.input<typeof pondEventInputSchema>;
export type UpdatePondEventInput = z.input<typeof updatePondEventSchema>;
export type CancelCycleInput = z.infer<typeof cancelCycleSchema>;
