import dotenv from "dotenv";
import { Worker } from "bullmq";
import { connectDb } from "../config/db";
import { bullConnection } from "../config/bullmq";
import { RideDispatchJobData } from "../queues/dispatch.queue";
import { dispatchRide } from "../services/ride.service";


dotenv.config();

const startDispatchWorker = async () => {
    await connectDb();

    const worker = new Worker<RideDispatchJobData>(
        "ride-dispatch",
        async (job) => {
            console.log("Dispatch job received", {
                jobId: job.id,
                rideId: job.data.rideId,
            });

            const result = await dispatchRide(job.data.rideId);

            console.log("Dispatch result", {
                jobId: job.id,
                rideId: job.data.rideId,
                result,
            });
        },

        {
            connection: bullConnection,
        }
    );

    worker.on("completed", (job) => {
        console.log("Dispatch job completed", {
            jobId: job.id,
            rideId: job.data.rideId,
        });
    });

    worker.on("failed", (job, error) => {
        console.error("Dispatch job failed", {
            jobId: job?.id,
            rideId: job?.data.rideId,
            error,
        });
    });

    console.log("Dispatch worker started");
};

startDispatchWorker();
