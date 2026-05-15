import express from "express";
import * as controller from "../controllers/driver.controller";

const router = express.Router();

router.get("/nearby", controller.getNearbyDriver);
router.patch("/:id/location", controller.updateDriverLocation);
router.post("/:id/embedding", controller.queueDriverEmbedding);
router.post("/match", controller.matchDrivers);

export default router;