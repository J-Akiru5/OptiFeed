export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordMode = "temporary" | "permanent";
export type PasswordStrength = "weak" | "medium" | "strong";
export type PasswordErrorCode =
	| "empty"
	| "too_short"
	| "too_long"
	| "missing_letter"
	| "missing_number"
	| "common";

const COMMON_PASSWORDS = new Set([
	"password",
	"password1",
	"password12",
	"password123",
	"12345678",
	"123456789",
	"1234567890",
	"qwerty123",
	"qwertyuiop",
	"letmein1",
	"admin123",
	"welcome1",
	"iloveyou1",
	"abc12345",
	"football1",
	"monkey123",
	"dragon123",
	"sunshine1",
	"princess1",
	"trustno1",
]);

const encoder = new TextEncoder();

function byteLength(value: string): number {
	return encoder.encode(value).length;
}

export function passwordChecks(password: string) {
	return {
		minLength: [...password].length >= PASSWORD_MIN_LENGTH,
		letter: /\p{L}/u.test(password),
		number: /\d/.test(password),
		upper: /\p{Lu}/u.test(password),
		symbol: /[^\p{L}\d\s]/u.test(password),
	};
}

export function validatePassword(
	password: string,
	mode: PasswordMode = "permanent",
): { ok: true } | { ok: false; code: PasswordErrorCode } {
	if (!password) return { ok: false, code: "empty" };
	if (byteLength(password) > PASSWORD_MAX_BYTES) return { ok: false, code: "too_long" };

	// Temporary passwords are provisioned by an admin and replaced on first
	// login. They only need to be non-empty and within the bcrypt limit.
	if (mode === "temporary") return { ok: true };

	if ([...password].length < PASSWORD_MIN_LENGTH) return { ok: false, code: "too_short" };
	if (!/\p{L}/u.test(password)) return { ok: false, code: "missing_letter" };
	if (!/\d/.test(password)) return { ok: false, code: "missing_number" };
	if (COMMON_PASSWORDS.has(password.toLowerCase())) return { ok: false, code: "common" };

	return { ok: true };
}

export function getPasswordStrength(password: string): PasswordStrength {
	const validation = validatePassword(password, "permanent");
	if (!validation.ok) return "weak";

	const checks = passwordChecks(password);
	const longEnough = [...password].length >= 12;
	return longEnough && (checks.upper || checks.symbol) ? "strong" : "medium";
}

export function passwordErrorMessage(code: PasswordErrorCode): string {
	switch (code) {
		case "empty":
			return "Password is required.";
		case "too_short":
			return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
		case "too_long":
			return `Password is too long (maximum ${PASSWORD_MAX_BYTES} bytes).`;
		case "missing_letter":
			return "Password must include at least one letter.";
		case "missing_number":
			return "Password must include at least one number.";
		case "common":
			return "That password is too common. Choose a stronger one.";
	}
}
