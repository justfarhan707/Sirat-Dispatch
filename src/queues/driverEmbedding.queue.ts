import { Queue } from 'bullmq';
import { bullConnection } from '../config/bullmq';


export type DriverEmbeddingJobData = {
    driverId: string;
}


export const driverEmbeddingQueue = new Queue<DriverEmbeddingJobData>(
    "driver-embedding", {
    connection: bullConnection,

});

export const enqueueDriverEmbeddingJob = async (driverId: string) => {
    const job = await driverEmbeddingQueue.add(
        "generate-driver-embadding",
        { driverId },
        {
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 2000,
            },

            removeOnComplete: 50,
            removeOnFail: 100,
        }
    );

    return job;
}