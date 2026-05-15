import dotenv from "dotenv";
import { connectDb } from "../config/db";
import { startRideTimeoutScheduler } from "../schedulers/rideTimeout.scheduler";

dotenv.config();

const startWorker = async () => {
    await connectDb();

    startRideTimeoutScheduler();
};

startWorker().catch((err) => {
    console.error("Ride timeout scheduler failed:", err);
    process.exit(1);
});
