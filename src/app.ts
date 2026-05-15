import express from "express";
import driverRouter from "./routes/driver.routes";
import rideRouter from "./routes/ride.routes";
import geoRoutes from "./routes/geo.routes";


const app = express();

//middlewares
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader("X-Instance-Id", process.env.INSTANCE_ID || "unknown");
    next();
});

app.use("/drivers", driverRouter);
app.use("/rides", rideRouter);
app.use("/geo", geoRoutes);


//test route
app.get("/", (req, res) => {
    res.send("Sirat is runningggggg");
});

export default app;
