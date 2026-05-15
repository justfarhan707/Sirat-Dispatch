import dotenv from "dotenv";
import app from "./location.app";

dotenv.config();

const port = process.env.LOCATION_SERVICE_PORT || 4001;

app.listen(port, () => {
    console.log(`location service running on http://localhost:${port}`);
})