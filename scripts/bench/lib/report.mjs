/**
 * PASS/FAIL/SKIP table for the bench harness.
 *
 * Plain ASCII and fixed-width columns so the output survives a Windows
 * terminal, a CI log and a pasted PR body unchanged. Details never carry a
 * token, a service key, a cron secret or a signed URL query string; callers
 * pass already-redacted evidence.
 */

export class BenchReport {
	constructor(title) {
		this.title = title;
		this.rows = [];
		this.startedAt = Date.now();
	}

	pass(area, check, detail = "") {
		this.#add("PASS", area, check, detail);
	}

	fail(area, check, detail = "") {
		this.#add("FAIL", area, check, detail);
	}

	skip(area, check, detail = "") {
		this.#add("SKIP", area, check, detail);
	}

	warn(area, check, detail = "") {
		this.#add("WARN", area, check, detail);
	}

	#add(status, area, check, detail) {
		this.rows.push({ status, area, check, detail: String(detail) });
		if (status === "FAIL") {
			// Print failures immediately as well: a long run must not hide the
			// first broken assertion behind later network waits.
			process.stderr.write(`[FAIL] ${area}: ${check}${detail ? ` (${detail})` : ""}\n`);
		}
	}

	get failures() {
		return this.rows.filter((row) => row.status === "FAIL").length;
	}

	get skipped() {
		return this.rows.filter((row) => row.status === "SKIP").length;
	}

	get passed() {
		return this.rows.filter((row) => row.status === "PASS").length;
	}

	get warned() {
		return this.rows.filter((row) => row.status === "WARN").length;
	}

	print() {
		const headers = ["#", "Area", "Assertion", "Result", "Evidence"];
		const rows = this.rows.map((row, index) => [
			String(index + 1),
			row.area,
			row.check,
			row.status,
			row.detail.replace(/\s+/g, " ").trim(),
		]);

		const widths = headers.map((header, column) =>
			Math.max(
				header.length,
				...rows.map((row) =>
					Math.min(row[column].length, column === 2 ? 78 : column === 4 ? 96 : 64),
				),
			),
		);

		const line = (cells) =>
			cells
				.map((cell, column) => {
					const width = widths[column];
					const text = cell.length > width ? `${cell.slice(0, Math.max(0, width - 1))}~` : cell;
					return text.padEnd(width, " ");
				})
				.join("  ")
				.trimEnd();

		const rule = widths.map((width) => "-".repeat(width)).join("  ");
		const out = [];
		out.push("");
		out.push(this.title);
		out.push(rule);
		out.push(line(headers));
		out.push(rule);
		for (const row of rows) {
			out.push(line(row));
		}
		out.push(rule);
		const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
		out.push(
			`${this.passed} passed, ${this.failures} failed, ${this.skipped} skipped, ` +
				`${this.warned} warning(s) in ${seconds}s`,
		);
		out.push("");
		process.stdout.write(`${out.join("\n")}\n`);
	}

	exitCode() {
		return this.failures > 0 ? 1 : 0;
	}
}
