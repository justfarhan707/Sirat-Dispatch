import dotenv from "dotenv";
import { Worker } from "bullmq";
import { bullConnection } from "../config/bullmq";
import { connectDb } from "../config/db";
import { getGeminiClient } from "../config/gemini";
import Driver from "../models/driver.model";
import {
    markDriverEmbeddingCompleted,
    markDriverEmbeddingFailed,
} from "../services/driver.service";
import { DriverEmbeddingJobData } from "../queues/driverEmbedding.queue";

dotenv.config();

const buildDriverProfileText = (driver: any) => {
    return [
        `${driver.name} is a ${driver.vehicle?.type} driver.`,
        `Vehicle plate number is ${driver.vehicle?.plateNumber}.`,
        `Driver phone is ${driver.phone}.`,
        `Driver rating is ${driver.rating}.`,
        driver.isAvailable
            ? "Driver is currently available."
            : "Driver is currently unavailable.",
        driver.petFriendly
            ? "Driver is pet friendly."
            : "Driver is not pet friendly.",
        `Driver has completed ${driver.airportTripsCount || 0} airport trips.`,
        driver.languages?.length
            ? `Driver speaks ${driver.languages.join(", ")}.`
            : "Driver language preferences are not specified.",
        driver.serviceTags?.length
            ? `Driver service tags: ${driver.serviceTags.join(", ")}.`
            : "Driver has no special service tags.",
        driver.preferredRideTypes?.length
            ? `Driver prefers ${driver.preferredRideTypes.join(", ")} rides.`
            : "Driver has no preferred ride type.",
    ].join(" ");
};


const worker = new Worker<DriverEmbeddingJobData>(
    "driver-embedding",
    async (job) => {
        const { driverId } = job.data;

        const driver = await Driver.findById(driverId);

        if (!driver) {
            throw new Error("Driver not found");
        }

        const profileText = buildDriverProfileText(driver);

        const gemini = getGeminiClient();

        const response = await gemini.models.embedContent({
            model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
            contents: profileText,
            config: {
                outputDimensionality: 768,
            },
        });

        const embedding = response.embeddings?.[0]?.values;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error("Failed to generate embedding");
        }

        await markDriverEmbeddingCompleted(driverId, profileText, embedding);

        return {
            driverId,
            profileText,
            embeddingLength: embedding.length,
        };
    },
    {
        connection: bullConnection,
    }
);

worker.on("completed", (job, result) => {
    console.log(`Embedding job completed: ${job.id}`);
    console.log(result);
});

worker.on("failed", async (job, err) => {
    if (job?.data?.driverId) {
        await markDriverEmbeddingFailed(job.data.driverId);
    }

    console.error(`Embedding job failed: ${job?.id}`, err.message);
});

const startWorker = async () => {
    await connectDb();
    console.log("Driver embedding worker started");
};

startWorker();
