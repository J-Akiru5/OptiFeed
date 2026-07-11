import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

export function isGeminiEnabled(): boolean {
	return !!apiKey;
}

export async function askGemini(
	userMessage: string,
	systemInstruction: string,
): Promise<string | null> {
	if (!apiKey) return null;

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({
			model: "gemini-2.0-flash",
			systemInstruction,
		});

		const result = await model.generateContent(userMessage);
		return result.response.text();
	} catch (error: unknown) {
		// Log the full error for debugging
		console.error("[Gemini] Error:", error);

		// Check for quota/rate-limit errors
		const status = (error as { status?: number }).status;
		const message = String((error as { message?: string }).message ?? "");
		const isQuotaError =
			status === 429 ||
			message.includes("429") ||
			message.includes("RESOURCE_EXHAUSTED") ||
			message.includes("exceeded your current quota");

		if (isQuotaError) {
			console.warn("[Gemini] Quota/rate-limit hit, falling back to keyword assistant");
			return null;
		}
		throw error;
	}
}
