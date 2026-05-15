import express from "express";
import * as controller from "../controllers/ride.controller";

const router = express.Router();

router.post("/", controller.createRide);
router.get("/:id", controller.getRide);
router.patch("/:id/accept", controller.acceptRide);
router.patch("/:id/reject", controller.rejectRide);
router.patch("/:id/complete", controller.completeRide);
router.patch("/:id/cancel", controller.cancelRide);



export default router;
