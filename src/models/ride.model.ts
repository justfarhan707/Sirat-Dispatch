import mongoose, { Schema } from "mongoose";

const rideSchema = new Schema(
    {
        pickup: {
            lat: {
                type: Number,
                required: true,
            },
            lng: {
                type: Number,
                required: true,
            },
        },

        dropoff: {
            lat: {
                type: Number,
                required: true,
            },
            lng: {
                type: Number,
                required: true,
            },
        },

        query: {
            type: String,
            default: "",
        },

        matchingMode: {
            type: String,
            enum: ["standard", "semantic"],
            default: "standard",
        },

        status: {
            type: String,
            enum: [
                "searching",
                "assigned",
                "ongoing",
                "completed",
                "cancelled",
                "no_driver_found",
            ],
            default: "searching",
            index: true,
        },

        assignedDriver: {
            type: Schema.Types.ObjectId,
            ref: "Driver",
            default: null,
            index: true,
        },

        assignmentExpiresAt: {
            type: Date,
            default: null,
        },

        lastAssignedAt: {
            type: Date,
            default: null,
        },

        assignmentVersion: {
            type: Number,
            default: 0,
        },

        attemptedDrivers: [
            {
                driver: {
                    type: Schema.Types.ObjectId,
                    ref: "Driver",
                    required: true,
                },
                status: {
                    type: String,
                    enum: ["rejected", "timed_out"],
                    required: true,
                },
                attemptedAt: {
                    type: Date,
                    default: Date.now,
                },
                assignmentVersion: {
                    type: Number,
                    required: true,
                },
            },
        ],

    },
    { timestamps: true }
);

rideSchema.index({
    status: 1,
    assignmentExpiresAt: 1,
});

rideSchema.index({
    assignedDriver: 1,
    status: 1,
});


export default mongoose.model("Ride", rideSchema);
