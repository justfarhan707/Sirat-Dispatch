import { GoogleGenAI } from "@google/genai";

let geminiClient: GoogleGenAI | null = null;

export const getGeminiClient = () => {
    if (geminiClient) {
        return geminiClient;
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set");
    }

    geminiClient = new GoogleGenAI({
        apiKey,
    });

    return geminiClient;
};
