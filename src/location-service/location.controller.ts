import { Request, Response } from "express";
import * as locationService from "./location.service"

export const healthCheck = (req: Request, res: Response) => {
    return res.json({
        service: "Location - service",
        status: "Ok",
    })
};

export const updateLocation = async (req: Request, res: Response) => {
    try {
        const { driverId, lat, lng, isAvailable } = req.body;

        if (!driverId || lat === undefined || lng === undefined) {
            return res.status(400).json({
                message: "driverId, lat and lng are required",
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

        const liveState = await locationService.updateLiveDriverLocation(
            String(driverId),
            latitude,
            longitude,
            typeof isAvailable === "boolean" ? isAvailable : undefined
        );

        return res.json(liveState);
    } catch (err) {
        console.error("updateLocation error:", err);
        return res.status(500).json({ message: "server error" });
    }
};

export const getNearbyDrivers = async (req: Request, res: Response) => {
    try {
        const { lat, lng, ring } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                message: "lat and lng are required",
            });
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

        const drivers = await locationService.findNearbyLiveDrivers(
            latitude,
            longitude,
            ringSize
        );

        return res.json(drivers);
    } catch (err) {
        console.error("getNearbyDrivers error:", err);
        return res.status(500).json({ message: "server error" });
    }
};


export const updateDriverAvailability = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { isAvailable } = req.body;

        if (!id) {
            return res.status(400).json({
                message: "driver id is required",
            });
        }

        if (typeof isAvailable !== "boolean") {
            return res.status(400).json({
                message: "isAvailable must be a boolean",
            });
        }

        const liveDriver = await locationService.updateLiveDriverAvailability(
            id as string,
            isAvailable
        );

        if (!liveDriver) {
            return res.status(404).json({
                message: "Live driver location not found",
            });
        }

        return res.json(liveDriver);
    } catch (err) {
        console.error("updateDriverAvailability error:", err);
        return res.status(500).json({ message: "server error" });
    }
};
