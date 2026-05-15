import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import app from "./app";
import { connectDb } from "./config/db";
import { initSocket } from "./socket";
import { subscribeToDriverLocationUpdates } from "./pubsub/driverLocation.pubsub";
import { attachSocketRedisAdapter } from "./config/socketAdapter";


dotenv.config();

const port = process.env.PORT || 3000;

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const startServer = async () => {
  await attachSocketRedisAdapter(io);
  initSocket(io);

  await connectDb();

  if (process.env.ENABLE_DRIVER_LOCATION_SUBSCRIBER === "false") {
    console.log("Driver location Redis subscriber disabled for this Core API instance");
  } else {
    await subscribeToDriverLocationUpdates();
  }

  httpServer.listen(port, () => {
    console.log(`server running on http://localhost:${port}`);
  });
};


startServer();
