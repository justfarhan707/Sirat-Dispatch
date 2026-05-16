import Driver from "../models/driver.model";
import Ride from "../models/ride.model";
import {
    findNearbyDriversByRing,
    rankDriversByIntentWithMetadata,
} from "./driver.service";
import { updateLiveDriverAvailability } from "../clients/location.client";
import {
    getDriverResponseTimeoutMs,
    getMaxDispatchAttempts,
} from "../config/rideTimeout";

import {
    removeRideResponseTimeout,
    scheduleRideResponseTimeout,
} from "../schedulers/rideTimeout.deadline";
import { logDispatchEvent } from "../utils/dispatchLogger";


type CreateRideInput = {
    pickup: {
        lat: number;
        lng: number;
    };
    dropoff: {
        lat: number;
        lng: number;
    };
    query: string;
    matchingMode: "standard" | "semantic";
};

const findCandidateDriversWithSearchWidening = async (
    pickup: { lat: number; lng: number },
    query: string,
    matchingMode: "standard" | "semantic",
    excludedDriverIds: string[] = []
) => {
    const ringSizes = [2, 3, 4];
    let semanticFailureReason: string | null = null;
    let eligibleDriverCount = 0;

    for (const ringSize of ringSizes) {
        const nearbyDrivers = await findNearbyDriversByRing(
            pickup.lat,
            pickup.lng,
            ringSize
        );

        if (matchingMode === "semantic") {
            const semanticResult = await rankDriversByIntentWithMetadata(
                nearbyDrivers,
                query || ""
            );

            semanticFailureReason = semanticResult.reason;
            eligibleDriverCount = semanticResult.eligibleDriverCount;

            const filteredCandidates = semanticResult.drivers.filter(
                (driver: any) => !excludedDriverIds.includes(String(driver._id))
            );

            if (filteredCandidates.length > 0) {
                console.log(`Found semantic candidates using ring size ${ringSize}`);

                return {
                    drivers: filteredCandidates,
                    semanticFailureReason: null,
                    eligibleDriverCount,
                };
            }

            continue;
        }

        const filteredCandidates = nearbyDrivers.filter(
            (driver: any) => !excludedDriverIds.includes(String(driver._id))
        );

        if (filteredCandidates.length > 0) {
            console.log(`Found candidates using ring size ${ringSize}`);

            return {
                drivers: filteredCandidates,
                semanticFailureReason: null,
                eligibleDriverCount: 0,
            };
        }
    }

    return {
        drivers: [],
        semanticFailureReason,
        eligibleDriverCount,
    };
};


//splitting of service earlier createRideAndAssignDriver now both splitted

export const createRide = async ({
    pickup,
    dropoff,
    query,
    matchingMode,
}: CreateRideInput) => {
    const ride = await Ride.create({
        pickup,
        dropoff,
        query,
        matchingMode,
        status: "searching",
        assignedDriver: null,
        assignmentExpiresAt: null,
        assignmentVersion: 0,
    });

    logDispatchEvent("ride_created", {
        rideId: String(ride._id),
        matchingMode,
        pickup,
    });

    return {
        ride,
    };
};

export const dispatchRide = async (rideId: string) => {
    const ride = await Ride.findById(rideId);

    if (!ride) {
        return null;
    }

    if (ride.status !== "searching") {
        return {
            ride,
            assignedDriver: null,
            skipped: true,
            reason: `ride_status_${ride.status}`,
        };
    }

    if (!ride.pickup) {
        return {
            ride,
            assignedDriver: null,
            skipped: true,
            reason: "missing_pickup",
        };
    }


    const candidateSearch = await findCandidateDriversWithSearchWidening(
        ride.pickup,
        ride.query,
        ride.matchingMode
    );

    const candidateDrivers = candidateSearch.drivers;

    if (candidateDrivers.length === 0) {
        if (ride.matchingMode === "semantic") {
            ride.status = "no_driver_found";
            ride.dispatchFailureReason = candidateSearch.semanticFailureReason;
            await ride.save();

            logDispatchEvent("semantic_match_failed", {
                rideId: String(ride._id),
                reason: candidateSearch.semanticFailureReason,
                eligibleDriverCount: candidateSearch.eligibleDriverCount,
            });

            return {
                ride,
                assignedDriver: null,
            };
        }

        logDispatchEvent("no_candidates_found", {
            rideId: String(ride._id),
            matchingMode: ride.matchingMode,
        });

        return {
            ride,
            assignedDriver: null,
        };
    }

    for (const candidate of candidateDrivers) {
        const assignedDriver = await Driver.findOneAndUpdate(
            {
                _id: candidate._id,
                isAvailable: true,
                availabilityStatus: "available",
                currentRide: null,
            },
            {
                isAvailable: false,
                availabilityStatus: "offered",
                currentRide: ride._id,
            },
            {
                returnDocument: "after",
            }
        );

        if (!assignedDriver) {
            logDispatchEvent("driver_claim_failed", {
                rideId: String(ride._id),
                driverId: String(candidate._id),
                reason: "driver_not_available",
            });

            continue;
        }

        logDispatchEvent("driver_claimed", {
            rideId: String(ride._id),
            driverId: String(assignedDriver._id),
        });

        await updateLiveDriverAvailability(String(assignedDriver._id), false);

        const now = new Date();
        const assignmentExpiresAt = new Date(
            now.getTime() + getDriverResponseTimeoutMs()
        );

        ride.status = "assigned";
        ride.assignedDriver = assignedDriver._id;
        ride.lastAssignedAt = now;
        ride.assignmentExpiresAt = assignmentExpiresAt;
        ride.assignmentVersion += 1;
        ride.dispatchFailureReason = null;

        await ride.save();

        logDispatchEvent("ride_assigned", {
            rideId: String(ride._id),
            driverId: String(assignedDriver._id),
            assignmentVersion: ride.assignmentVersion,
            assignmentExpiresAt,
        });

        await scheduleRideResponseTimeout(
            String(ride._id),
            ride.assignmentVersion,
            assignmentExpiresAt
        );

        return {
            ride,
            assignedDriver,
        };
    }

    return {
        ride,
        assignedDriver: null,
    };
};

export const acceptAssignedRide = async (rideId: string) => {
    const ride = await Ride.findById(rideId);

    if (!ride) {
        return null;
    }

    if (ride.status !== "assigned") {
        return {
            error: "Only assigned ride can be accepted",
        };
    }

    if (!ride.assignedDriver) {
        return {
            error: "No driver assigned to this ride",
        };
    }

    if (ride.assignmentExpiresAt) {
        await removeRideResponseTimeout(
            String(ride._id),
            ride.assignmentVersion
        );
    }

    ride.status = "ongoing";
    ride.assignmentExpiresAt = null;

    await Driver.findByIdAndUpdate(ride.assignedDriver, {
        isAvailable: false,
        availabilityStatus: "busy",
        currentRide: ride._id,
    });

    await ride.save();

    logDispatchEvent("ride_accepted", {
        rideId: String(ride._id),
        driverId: String(ride.assignedDriver),
    });

    return {
        ride,
    };
};

export const rejectAssignedRide = async (
    rideId: string,
    attemptStatus: "rejected" | "timed_out" = "rejected"
) => {
    const ride = await Ride.findById(rideId);

    if (!ride) {
        return null;
    }

    if (ride.status !== "assigned") {
        return {
            error: "Only assigned rides can be rejected",
        };
    }

    if (!ride.assignedDriver) {
        return {
            error: "No driver assigned to this ride",
        };
    }

    if (!ride.pickup) {
        return {
            error: "Ride pickup location is missing",
        };
    }

    const rejectedDriverId = String(ride.assignedDriver);
    const currentAssignmentVersion = ride.assignmentVersion;

    ride.attemptedDrivers.push({
        driver: ride.assignedDriver,
        status: attemptStatus,
        attemptedAt: new Date(),
        assignmentVersion: currentAssignmentVersion,
    });

    logDispatchEvent(
        attemptStatus === "timed_out" ? "driver_timed_out" : "driver_rejected",
        {
            rideId: String(ride._id),
            driverId: rejectedDriverId,
            assignmentVersion: currentAssignmentVersion,
        }
    );

    if (ride.assignmentExpiresAt) {
        await removeRideResponseTimeout(
            String(ride._id),
            currentAssignmentVersion
        );
    }

    await Driver.findByIdAndUpdate(rejectedDriverId, {
        isAvailable: true,
        availabilityStatus: "available",
        currentRide: null,
    });

    await updateLiveDriverAvailability(rejectedDriverId, true);

    if (ride.attemptedDrivers.length >= getMaxDispatchAttempts()) {
        ride.assignedDriver = null;
        ride.status = "no_driver_found";
        ride.assignmentExpiresAt = null;
        ride.dispatchFailureReason = "max_dispatch_attempts_reached";

        await ride.save();

        logDispatchEvent("ride_no_driver_found", {
            rideId: String(ride._id),
            attempts: ride.attemptedDrivers.length,
        });

        return {
            ride,
            assignedDriver: null,
            reassigned: false,
            reason: "max_dispatch_attempts_reached",
        };
    }

    const excludedDriverIds = ride.attemptedDrivers.map((attempt: any) =>
        String(attempt.driver)
    );

    const candidateSearch = await findCandidateDriversWithSearchWidening(
        {
            lat: ride.pickup.lat,
            lng: ride.pickup.lng,
        },
        ride.query,
        ride.matchingMode,
        excludedDriverIds
    );

    const filteredCandidates = candidateSearch.drivers;

    for (const candidate of filteredCandidates) {
        const reassignedDriver = await Driver.findOneAndUpdate(
            {
                _id: candidate._id,
                isAvailable: true,
                availabilityStatus: "available",
                currentRide: null,
            },
            {
                isAvailable: false,
                availabilityStatus: "offered",
                currentRide: ride._id,
            },
            {
                returnDocument: "after",
            }
        );

        if (!reassignedDriver) {
            continue;
        }

        await updateLiveDriverAvailability(String(reassignedDriver._id), false);

        const now = new Date();
        const assignmentExpiresAt = new Date(
            now.getTime() + getDriverResponseTimeoutMs()
        );

        ride.assignedDriver = reassignedDriver._id;
        ride.status = "assigned";
        ride.lastAssignedAt = now;
        ride.assignmentExpiresAt = assignmentExpiresAt;
        ride.assignmentVersion = currentAssignmentVersion + 1;
        ride.dispatchFailureReason = null;

        await ride.save();

        await scheduleRideResponseTimeout(
            String(ride._id),
            ride.assignmentVersion,
            assignmentExpiresAt
        );

        logDispatchEvent("ride_reassigned", {
            rideId: String(ride._id),
            driverId: String(reassignedDriver._id),
            assignmentVersion: ride.assignmentVersion,
        });

        return {
            ride,
            assignedDriver: reassignedDriver,
            reassigned: true,
        };
    }

    ride.assignedDriver = null;
    ride.assignmentExpiresAt = null;

    if (ride.matchingMode === "semantic") {
        ride.status = "no_driver_found";
        ride.dispatchFailureReason = candidateSearch.semanticFailureReason;

        await ride.save();

        logDispatchEvent("semantic_match_failed", {
            rideId: String(ride._id),
            reason: candidateSearch.semanticFailureReason,
            eligibleDriverCount: candidateSearch.eligibleDriverCount,
        });

        return {
            ride,
            assignedDriver: null,
            reassigned: false,
        };
    }

    ride.status = "searching";
    await ride.save();

    logDispatchEvent("ride_back_to_searching", {
        rideId: String(ride._id),
        attempts: ride.attemptedDrivers.length,
    });

    return {
        ride,
        assignedDriver: null,
        reassigned: false,
    };
};

export const getRideById = async (rideId: string) => {
    return Ride.findById(rideId).populate("assignedDriver");
};

export const getActiveRideForDriver = async (driverId: string) => {
    return Ride.findOne({
        assignedDriver: driverId,
        status: { $in: ["assigned", "ongoing"] },
    })
        .sort({ updatedAt: -1 })
        .populate("assignedDriver");
};

const releaseDriverFromRide = async (driverId: string) => {
    await Driver.findByIdAndUpdate(driverId, {
        isAvailable: true,
        availabilityStatus: "available",
        currentRide: null,
    });

    await updateLiveDriverAvailability(driverId, true);
};

export const completeRide = async (rideId: string) => {
    const ride = await Ride.findById(rideId);

    if (!ride) {
        return null;
    }

    if (ride.status !== "ongoing") {
        return {
            error: "Only ongoing rides can be completed",
        };
    }

    if (!ride.assignedDriver) {
        return {
            error: "No driver assigned to this ride",
        };
    }

    const driverId = String(ride.assignedDriver);

    await releaseDriverFromRide(driverId);

    ride.status = "completed";
    ride.assignmentExpiresAt = null;

    await ride.save();

    logDispatchEvent("ride_completed", {
        rideId: String(ride._id),
        driverId,
    });

    return {
        ride,
    };
};

export const cancelRide = async (rideId: string) => {
    const ride = await Ride.findById(rideId);

    if (!ride) {
        return null;
    }

    if (ride.status === "completed") {
        return {
            error: "Completed rides cannot be cancelled",
        };
    }

    if (ride.status === "cancelled") {
        return {
            error: "Ride is already cancelled",
        };
    }

    if (ride.assignedDriver) {
        const driverId = String(ride.assignedDriver);

        if (ride.assignmentExpiresAt) {
            await removeRideResponseTimeout(
                String(ride._id),
                ride.assignmentVersion
            );
        }

        await releaseDriverFromRide(driverId);
    }

    ride.status = "cancelled";
    ride.assignedDriver = null;
    ride.assignmentExpiresAt = null;

    await ride.save();

    logDispatchEvent("ride_cancelled", {
        rideId: String(ride._id),
    });

    return {
        ride,
    };
};

