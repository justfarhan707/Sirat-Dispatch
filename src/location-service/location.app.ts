import express from "express";
import locationRouter from "./location.routes";

const app = express();

app.use(express.json());

app.use("/", locationRouter);

export default app;
