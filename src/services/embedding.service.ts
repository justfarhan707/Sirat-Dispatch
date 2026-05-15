import { getGeminiClient } from "../config/gemini";

export const generateQueryEmbedding = async (text: string) => {
    const gemini = getGeminiClient();

    const response = await gemini.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        contents: text,
        config: {
            outputDimensionality: 768,
        },
    });

    const embedding = response.embeddings?.[0]?.values;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Failed to generate query embedding");
    }

    return embedding;
};
