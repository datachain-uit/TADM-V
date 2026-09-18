const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../../.env"),
    quiet: true,
});

let connectionPromise: Promise<any> | null = null;

async function connectDatabase() {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is missing. Check backend/.env");
    if (!connectionPromise) {
        connectionPromise = mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    }
    try {
        await connectionPromise;
        return mongoose.connection;
    } catch (error) {
        connectionPromise = null;
        throw error;
    }
}

async function disconnectDatabase() {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    connectionPromise = null;
}

module.exports = { connectDatabase, disconnectDatabase };
