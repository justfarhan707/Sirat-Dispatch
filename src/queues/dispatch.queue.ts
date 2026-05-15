import { Queue } from "bullmq";
import { bullConnection } from "../config/bullmq";

export type RideDispatchJobData = {
    rideId: string;
};

export const rideDispatchQueue = new Queue<RideDispatchJobData>("ride-dispatch", {
    connection: bullConnection,
});

export const enqueueRideDispatchJob = async (rideId: string) => {
    return rideDispatchQueue.add(
        "dispatch-ride",
        {
            rideId,
        },
        {
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
        }
    );
};
