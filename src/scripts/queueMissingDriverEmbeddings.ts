import dns from "dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Driver from "../models/driver.model";
import {
    redisCache,
    redisPub,
    redisSub,
} from "../config/redis";
import { enqueueDriverEmbeddingJob } from "../queues/driverEmbedding.queue";
import { markDriverEmbeddingPending } from "../services/driver.service";

dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

const queueMissingDriverEmbeddings = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const drivers = await Driver.find({
        embeddingStatus: { $ne: "completed" },
    })
        .select("_id name embeddingStatus")
        .lean();

    console.log("Driver embedding queue preview:");
    console.log({
        missingEmbeddings: drivers.length,
    });

    for (const driver of drivers) {
        const driverId = String(driver._id);

        await markDriverEmbeddingPending(driverId);
        const job = await enqueueDriverEmbeddingJob(driverId);

        console.log("Queued embedding job:", {
            driverId,
            name: driver.name,
            jobId: job.id,
        });
    }

    console.log("Queued missing driver embeddings complete.");
};

queueMissingDriverEmbeddings()
    .catch((error) => {
        console.error("Queue missing driver embeddings failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
        redisCache.disconnect();
        redisPub.disconnect();
        redisSub.disconnect();
    });