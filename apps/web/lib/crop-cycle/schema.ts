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
		if (daysBetween(value.actualHarvestDate, todayDateOnly()) < 0) {
			ctx.addIssue({
				code: "custom",
				path: ["actualHarvestDate"],
				message: "Harvest date cannot be in the future",
			});
		}
	});

export const manualEventTypes = ["MAINTENANCE", "OTHER"] as const;

export const pondEventInputSchema = z
	.object({
		pondId: z.string().min(1),
		cropCycleId: z.string().min(1).nullish(),
		type: z.enum(manualEventTypes),
		title: z.string().trim().min(1, "Add a title").max(80, "Title is too long"),
		startsAt: dateOnlySchema,
		notes: optionalText(1_000),
	})
	.superRefine((value, ctx) => {
		if (daysBetween(value.startsAt, todayDateOnly()) < -365) {
			ctx.addIssue({
				code: "custom",
				path: ["startsAt"],
				message: "Event date is too far in the future",
			});
		}
	});

export const updatePondEventSchema = z.object({
	id: z.string().min(1),
	title: z.string().trim().min(1, "Add a title").max(80, "Title is too long"),
	startsAt: dateOnlySchema,
	notes: optionalText(1_000),
});

export const completePondEventSchema = z.object({ id: z.string().min(1) });
export const deletePondEventSchema = z.object({ id: z.string().min(1) });

export const cancelCycleSchema = z.object({
	pondId: z.string().min(1),
	cycleId: z.string().min(1),
	notes: optionalText(1_000),
});

export type CropCycleInput = z.infer<typeof cropCycleInputSchema>;
export type HarvestInput = z.infer<typeof harvestInputSchema>;
export type PondEventInput = z.infer<typeof pondEventInputSchema>;
export type UpdatePondEventInput = z.infer<typeof updatePondEventSchema>;
export type CancelCycleInput = z.infer<typeof cancelCycleSchema>;
