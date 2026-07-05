// TODO(karl): Implement seed data for local development and review environments once the data model is locked.

async function main() {
	// TODO(karl): Add seed logic for Ponds, Devices, BiomassLogs, FeedingEvents, FcrReports, and Notifications.
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		// TODO(karl): Disconnect Prisma client after seeding.
	});
