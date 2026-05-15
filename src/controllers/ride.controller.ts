
import { Request, Response } from "express";
import * as rideService from "../services/ride.service";
import { enqueueRideDispatchJob } from "../queues/dispatch.queue";


export const createRide = async (req: Request, res: Response) => {
    try {
        const { pickup, dropoff, query, matchingMode } = req.body;

        if (
            !pickup ||
            pickup.lat === undefined ||
            pickup.lng === undefined ||
            !dropoff ||
            dropoff.lat === undefined ||
            dropoff.lng === undefined
        ) {
            return res.status(400).json({
                message: "Pickup and dropoff required"
            });
        }

        const pickupLat = Number(pickup.lat);
        const pickupLng = Number(pickup.lng);
        const dropoffLat = Number(dropoff.lat);
        const dropoffLng = Number(dropoff.lng);

        if (
            Number.isNaN(pickupLat) ||
            Number.isNaN(pickupLng) ||
            Number.isNaN(dropoffLat) ||
            Number.isNaN(dropoffLng)
        ) {
            return res.status(400).json({
                message: "pickup and dropoff coordinates must be valid numbers",
            });
        }

        const mode = matchingMode === "semantic" ? "semantic" : "standard";

        if (mode === "semantic" && !query) {
            return res.status(400).json({
                message: "query is required for semantic matching",
            });
        }

        const result = await rideService.createRide({
            pickup: {
                lat: pickupLat,
                lng: pickupLng,
            },
            dropoff: {
                lat: dropoffLat,
                lng: dropoffLng,
            },
            query: query ? String(query) : "",
            matchingMode: mode,
        });

        await enqueueRideDispatchJob(String(result.ride._id));

        return res.status(201).json({
            ...result,
            dispatchQueued: true,
        });

    } catch (err) {
        console.error("createRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
}

export const acceptRide = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await rideService.acceptAssignedRide(id as string);

        if (!result) {
            return res.status(404).json({ message: "Ride not found" });
        }

        if (result.error) {
            return res.status(400).json({ message: result.error });
        }

        return res.json(result);
    } catch (err) {
        console.error("acceptRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
};


export const rejectRide = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await rideService.rejectAssignedRide(id as string);

        if (!result) {
            return res.status(404).json({ message: "Ride not found" });
        }

        if (result.error) {
            return res.status(400).json({ message: result.error });
        }

        return res.json(result);
    } catch (err) {
        console.error("rejectRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
};

export const getRide = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const ride = await rideService.getRideById(id as string);

        if (!ride) {
            return res.status(404).json({ message: "Ride not found" });
        }

        return res.json({ ride });
    } catch (err) {
        console.error("getRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
};

export const completeRide = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await rideService.completeRide(id as string);

        if (!result) {
            return res.status(404).json({ message: "Ride not found" });
        }

        if (result.error) {
            return res.status(400).json({ message: result.error });
        }

        return res.json(result);
    } catch (err) {
        console.error("completeRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
};


export const cancelRide = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await rideService.cancelRide(id as string);

        if (!result) {
            return res.status(404).json({ message: "Ride not found" });
        }

        if (result.error) {
            return res.status(400).json({ message: result.error });
        }

        return res.json(result);
    } catch (err) {
        console.error("cancelRide error:", err);
        return res.status(500).json({ message: "server error" });
    }
};