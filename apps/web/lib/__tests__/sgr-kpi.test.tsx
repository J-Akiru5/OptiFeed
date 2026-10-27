import { SgrKpi, type SgrKpiLabels } from "@/components/growth/SgrKpi";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const labels: SgrKpiLabels = {
	title: "Specific Growth Rate",
	overall: "Overall since first sampling",
	averageGain: "Average daily gain",
	unit: "%/day",
	explanation: "How fast the fish gain weight each day, as a percentage of their body weight.",
	reasons: {
		insufficientSamples: "Log at least two samplings to see SGR.",
		invalidWeight: "SGR needs a positive average body weight in both samplings.",
		intervalTooShort: "SGR needs samplings at least one day apart.",
	},
};

describe("SgrKpi", () => {
	it("shows the latest and overall SGR, the unit and the explanation", () => {
		const html = renderToStaticMarkup(
			<SgrKpi
				latestSgrPctPerDay={2.3104}
				overallSgrPctPerDay={2.31}
				averageDailyGainG={0.33}
				reason={null}
				labels={labels}
			/>,
		);

		expect(html).toContain("Specific Growth Rate");
		expect(html).toContain("2.31");
		expect(html).toContain("%/day");
		expect(html).toContain("Overall since first sampling");
		expect(html).toContain("Average daily gain");
		expect(html).toContain("How fast the fish gain weight each day");
		expect(html).toContain("0.3 g/day");
		expect(html).not.toContain("Log at least two samplings");
	});

	it("shows a dash and the reason with fewer than two samplings", () => {
		const html = renderToStaticMarkup(
			<SgrKpi
				latestSgrPctPerDay={null}
				overallSgrPctPerDay={null}
				averageDailyGainG={null}
				reason="insufficientSamples"
				labels={labels}
			/>,
		);

		expect(html).toContain("—");
		expect(html).toContain("Log at least two samplings to see SGR.");
	});

	it("uses the warning colour for weight loss", () => {
		const html = renderToStaticMarkup(
			<SgrKpi
				latestSgrPctPerDay={-1.2}
				overallSgrPctPerDay={-0.8}
				averageDailyGainG={-1.5}
				reason={null}
				labels={labels}
			/>,
		);

		expect(html).toContain("text-red-600");
		expect(html).toContain("-1.20");
	});
});
