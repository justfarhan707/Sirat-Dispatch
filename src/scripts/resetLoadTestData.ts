import dns from "dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Driver from "../models/driver.model";
import Ride from "../models/ride.model";
import {
    redisCache,
    redisPub,
    redisSub,
    RIDE_RESPONSE_TIMEOUTS_KEY,
} from "../config/redis";

dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

const shouldConfirm = process.argv.includes("--confirm");

const loadTestRideFilter = {
    "pickup.lat": 19.07,
    "pickup.lng": 73,
    "dropoff.lat": 19.078,
    "dropoff.lng": 73.01,
    query: "",
    matchingMode: "standard",
};

const resetLoadTestData = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const rides = await Ride.find(loadTestRideFilter)
        .select("_id assignmentVersion status assignedDriver createdAt")
        .lean();

    const rideIds = rides.map((ride) => ride._id);

    const lockedDriversCount = await Driver.countDocuments({
        currentRide: { $in: rideIds },
    });

    console.log("Load-test reset preview:");
    console.log({
        matchingRides: rides.length,
        lockedDrivers: lockedDriversCount,
        confirm: shouldConfirm,
    });

    if (!shouldConfirm) {
        console.log("Dry run only. Re-run with --confirm to delete these rides and free their drivers.");
        return;
    }

    const driverResetResult = await Driver.updateMany(
        { currentRide: { $in: rideIds } },
        {
            $set: {
                isAvailable: true,
                availabilityStatus: "available",
                currentRide: null,
            },
        }
    );

    const timeoutMembers = await redisCache.zrange(RIDE_RESPONSE_TIMEOUTS_KEY, 0, -1);
    const staleTimeoutMembers = timeoutMembers.filter((member) => {
        try {
            const payload = JSON.parse(member);
            return rideIds.some((rideId) => String(rideId) === payload.rideId);
        } catch {
            return false;
        }
    });

    if (staleTimeoutMembers.length > 0) {
        await redisCache.zrem(RIDE_RESPONSE_TIMEOUTS_KEY, ...staleTimeoutMembers);
    }

    const rideDeleteResult = await Ride.deleteMany({
        _id: { $in: rideIds },
    });

    console.log("Load-test reset complete:");
    console.log({
        deletedRides: rideDeleteResult.deletedCount,
        resetDrivers: driverResetResult.modifiedCount,
        removedTimeouts: staleTimeoutMembers.length,
    });
};

resetLoadTestData()
    .catch((error) => {
        console.error("Load-test reset failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
        redisCache.disconnect();
        redisPub.disconnect();
        redisSub.disconnect();
    });
