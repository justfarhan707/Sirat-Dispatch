import dns from "dns";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

export const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI as string);
        console.log("Mongo db connected");
    } catch (err) {
        console.log("connecton failed ", err);
        process.exit(1);
    }
}