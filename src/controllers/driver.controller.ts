import { Request, Response } from "express";
import * as driverService from "../services/driver.service";
import { publishDriverLocationUpdated } from "../pubsub/driverLocation.pubsub";
import { enqueueDriverEmbeddingJob } from "../queues/driverEmbedding.queue";



export const getNearbyDriver = async (req: Request, res: Response) => {
    try {
        const { lat, lng, ring } = req.query  //req.querey gives me string | undefined

        if (!lat || !lng) {
            return res.status(400).json({ message: "Lat and lang required" });
        }

        const latitude = Number(lat);
        const longitude = Number(lng);
        const ringSize = ring ? Number(ring) : 2;

        if (
            Number.isNaN(latitude) ||
            Number.isNaN(longitude) ||
            Number.isNaN(ringSize)
        ) {
            return res.status(400).json({
                message: "lat, lng and ring must be valid numbers",
            });
        }

        if (
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return res.status(400).json({
                message: "invalid latitude or longitude range",
            });
        }

        if (ringSize < 0 || ringSize > 10) {
            return res.status(400).json({
                message: "ring must be between 0 and 10",
            });
        }

        const drivers = await driverService.findNearbyDriverMarkersByRing(
            latitude,
            longitude,
            ringSize
        );

        res.json(drivers)
    } catch (err) {
        res.status(500).json({ message: "server error" })
    }
}


export const updateDriverLocation = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { lat, lng, isAvailable } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ message: "lat and lng are required" });
        }

        const latitude = Number(lat);
        const longitude = Number(lng);

        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            return res.status(400).json({ message: "lat and lng must be valid numbers" });
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ message: "invalid latitude or longitude range" });
        }

        const driver = await driverService.updateDriverLocation(
            id as string,
            latitude,
            longitude,
            isAvailable
        );

        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }



        if (!driver.location || !driver.location.coordinates) {
            throw new Error("Driver location missing");
        }

        await publishDriverLocationUpdated({
            driverId: String(driver._id),
            location: {
                type: "Point",
                coordinates: driver.location.coordinates as [number, number],
            },
            h3Index: driver.h3Index!,
            isAvailable: driver.isAvailable,
            lastSeen: driver.lastSeen,
        });



        return res.json(driver);
    } catch (err) {
        return res.status(500).json({ message: "server error" });
    }
};

export const queueDriverEmbedding = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const driver = await driverService.markDriverEmbeddingPending(id as string);

        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        const job = await enqueueDriverEmbeddingJob(String(driver._id));

        return res.status(202).json({
            message: "Driver embedding job queued",
            driverId: String(driver._id),
            jobId: job.id,
            embeddingStatus: "pending",
        });
    } catch (err) {
        return res.status(500).json({ message: "server error" });
    }
};


export const matchDrivers = async (req: Request, res: Response) => {
    try {
        const { lat, lng, query } = req.body;

        if (lat === undefined || lng === undefined || !query) {
            return res.status(400).json({
                message: "lat, lng and query are required",
            });
        }

        const latitude = Number(lat);
        const longitude = Number(lng);

        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            return res.status(400).json({
                message: "lat and lng must be valid numbers",
            });
        }

        if (
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return res.status(400).json({
                message: "invalid latitude or longitude range",
            });
        }

        const matchedDrivers = await driverService.matchDriversByIntent(
            latitude,
            longitude,
            String(query)
        );

        return res.json(matchedDrivers);
    } catch (err) {
        return res.status(500).json({ message: "server error" });
    }
};


