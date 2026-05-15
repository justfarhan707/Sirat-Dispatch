import { Request, Response } from "express";
import { H3Service } from "../services/h3.service";

export const getH3Neighbours = (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const ring = req.query.ring ? Number(req.query.ring) : 2;

    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(ring)) {
        return res.status(400).json({
            message: "lat, lng and ring must be valid numbers",
        });
    }

    const center = H3Service.getIndex(lat, lng);
    const indexes = H3Service.getNeighbours(center, ring);

    return res.json({
        center,
        ring,
        indexes,
    });
};
