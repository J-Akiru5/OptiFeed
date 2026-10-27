import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/components/user-avatar";
import { avatarInitials } from "@/lib/avatar-initials";

describe("avatarInitials", () => {
	it("uses the first and last initial of a display name", () => {
		expect(avatarInitials("Juan Miguel")).toBe("JM");
		expect(avatarInitials("  maria   santos  ")).toBe("MS");
	});

	it("uses two letters for a single word, a farm id or an e-mail local part", () => {
		expect(avatarInitials("operator")).toBe("OP");
		expect(avatarInitials("demo-farmer-1")).toBe("DE");
		expect(avatarInitials("juan@example.com")).toBe("JU");
	});

	it("returns a neutral glyph when there is no name at all", () => {
		expect(avatarInitials(null)).toBe("?");
		expect(avatarInitials("   ")).toBe("?");
	});
});

describe("UserAvatar", () => {
	it("renders the signed picture as a decorative image", () => {
		const html = renderToStaticMarkup(
			<UserAvatar src="https://signed/avatar" name="Juan Miguel" className="rounded-xl" />,
		);

		expect(html).toContain('src="https://signed/avatar"');
		expect(html).toContain('alt=""');
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("rounded-xl");
	});

	it("falls back to initials when there is no picture or the URL failed", () => {
		for (const src of [null, undefined]) {
			const html = renderToStaticMarkup(<UserAvatar src={src} name="Juan Miguel" />);
			expect(html).not.toContain("<img");
			expect(html).toContain("JM");
		}
	});
});
