import { Router } from "express";
import { getH3Neighbours } from "../controllers/geo.controller";

const router = Router();

router.get("/h3-neighbors", getH3Neighbours);

export default router;
