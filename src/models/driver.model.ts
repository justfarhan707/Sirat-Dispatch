import mongoose, { Schema } from "mongoose";

const driverSchema = new Schema({
  name: {
    type: String,
    required: true,
  },

  phone: {
    type: String,
    required: true,
  },

  vehicle: {
    type: {
      type: String,
      enum: ["bike", "sedan", "suv"],
      required: true,
    },
    plateNumber: {
      type: String,
      required: true,
    },
  },

  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
    },
  },

  h3Index: {
    type: String,
    index: true, // 🔥 important
  },

  isAvailable: {
    type: Boolean,
    default: true,
    index: true,
  },

  availabilityStatus: {
    type: String,
    enum: ["available", "offered", "busy", "offline"],
    default: "available",
    index: true,
  },

  currentRide: {
    type: Schema.Types.ObjectId,
    ref: "Ride",
    default: null,
    index: true,
  },


  lastSeen: {
    type: Date,
    default: Date.now,
  },

  petFriendly: {
    type: Boolean,
    default: false,
  },

  airportTripsCount: {
    type: Number,
    default: 0,
  },

  languages: {
    type: [String],
    default: [],
  },

  serviceTags: {
    type: [String],
    default: [],
  },

  preferredRideTypes: {
    type: [String],
    default: [],
  },


  rating: {
    type: Number,
    default: 5,
  },

  profileText: {
    type: String,
    default: "",
  },

  embedding: {
    type: [Number],
    default: undefined,
  },


  embeddingStatus: {
    type: String,
    enum: ["not_started", "pending", "completed", "failed"],
    default: "not_started",
    index: true,
  },

  embeddingUpdatedAt: {
    type: Date,
  },

},
  { timestamps: true }
);
driverSchema.index({ location: "2dsphere" });

driverSchema.index({
  isAvailable: 1,
  availabilityStatus: 1,
  currentRide: 1,
});


export default mongoose.model("Driver", driverSchema)
