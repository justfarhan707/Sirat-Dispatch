import express from "express";
import * as controller from "./location.controller";

const router = express.Router();

router.get("/health", controller.healthCheck);
router.post("/location/update", controller.updateLocation);
router.get("/drivers/nearby", controller.getNearbyDrivers);
router.patch("/drivers/:id/availability", controller.updateDriverAvailability);




export default router;

