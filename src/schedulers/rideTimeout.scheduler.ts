import Ride from "../models/ride.model";
import { redisCache, RIDE_RESPONSE_TIMEOUTS_KEY } from "../config/redis";
import { rejectAssignedRide } from "../services/ride.service";
import {
    decodeRideTimeoutPayload,
    scheduleRideResponseTimeout,
} from "./rideTimeout.deadline";



const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 100;


const pollExpiredRideTimeouts = async () => {
    const now = Date.now();

    const expiredEntries = await redisCache.zrangebyscore(
        RIDE_RESPONSE_TIMEOUTS_KEY,
        0,
        now,
        "LIMIT",
        0,
        BATCH_SIZE
    );

    if (expiredEntries.length === 0) {
        return;
    }

    const claimedEntries: string[] = [];

    for (const entry of expiredEntries) {
        const removed = await redisCache.zrem(RIDE_RESPONSE_TIMEOUTS_KEY, entry);

        if (removed === 1) {
            claimedEntries.push(entry);
        }
    }

    if (claimedEntries.length === 0) {
        return;
    }

    const payloads = claimedEntries.map(decodeRideTimeoutPayload);
    const rideIds = [...new Set(payloads.map((payload) => payload.rideId))];

    const rides = await Ride.find({
        _id: {
            $in: rideIds,
        },
    });

    const rideById = new Map(rides.map((ride) => [String(ride._id), ride]));

    for (const payload of payloads) {
        const ride = rideById.get(payload.rideId);

        if (!ride) {
            console.log("Ride timeout skipped", {
                rideId: payload.rideId,
                reason: "ride_not_found",
            });
            continue;
        }

        if (ride.status !== "assigned") {
            console.log("Ride timeout skipped", {
                rideId: payload.rideId,
                reason: `ride_status_${ride.status}`,
            });
            continue;
        }

        if (ride.assignmentVersion !== payload.assignmentVersion) {
            console.log("Ride timeout skipped", {
                rideId: payload.rideId,
                reason: "stale_assignment_version",
                currentVersion: ride.assignmentVersion,
                expiredVersion: payload.assignmentVersion,
            });
            continue;
        }

        if (!ride.assignmentExpiresAt) {
            console.log("Ride timeout skipped", {
                rideId: payload.rideId,
                reason: "missing_assignment_expiry",
            });
            continue;
        }

        if (ride.assignmentExpiresAt.getTime() > now) {
            await scheduleRideResponseTimeout(
                payload.rideId,
                payload.assignmentVersion,
                ride.assignmentExpiresAt
            );

            console.log("Ride timeout rescheduled", {
                rideId: payload.rideId,
                assignmentVersion: payload.assignmentVersion,
            });

            continue;
        }

        const result = await rejectAssignedRide(payload.rideId, "timed_out");

        console.log("Ride timeout processed", {
            rideId: payload.rideId,
            assignmentVersion: payload.assignmentVersion,
            result,
        });
    }
};

export const startRideTimeoutScheduler = () => {
    setInterval(async () => {
        try {
            await pollExpiredRideTimeouts();
        } catch (err) {
            console.error("Ride timeout scheduler tick failed:", err);
        }
    }, POLL_INTERVAL_MS);

    console.log("Ride timeout scheduler started");
};
