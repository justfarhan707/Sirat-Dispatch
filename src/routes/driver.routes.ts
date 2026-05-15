import express from "express";
import * as controller from "../controllers/driver.controller";

const router = express.Router();

router.get("/", controller.listDrivers);
router.get("/nearby", controller.getNearbyDriver);
router.post("/match", controller.matchDrivers);
router.get("/:id/active-ride", controller.getActiveRideForDriver);
router.patch("/:id/location", controller.updateDriverLocation);
router.post("/:id/embedding", controller.queueDriverEmbedding);

export default router;
