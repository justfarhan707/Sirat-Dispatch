const { io } = require("socket.io-client");

const DRIVER_ID = "69bd286d347a415543dedb5e";

const socket = io("http://localhost:3000");

socket.on("connect", () => {
    console.log("Connected:", socket.id);

    socket.emit("subscribe:driver", DRIVER_ID);
    console.log(`Subscribed to driver:${DRIVER_ID}`);
});

socket.on("driver:locationUpdated", (data) => {
    console.log("Live update received:");
    console.log(data);
});

socket.on("disconnect", () => {
    console.log("Disconnected");
});
