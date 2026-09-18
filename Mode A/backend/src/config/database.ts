const mongoose = require("mongoose");
const {
    requiredEnvironment
} = require("./environment");

let connectionPromise: Promise<any> | null = null;

async function connectDatabase() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!connectionPromise) {
        connectionPromise = mongoose.connect(
            requiredEnvironment("MONGODB_URI"),
            {
                serverSelectionTimeoutMS: 10000
            }
        );
    }

    try {
        await connectionPromise;

        console.log(
            "MongoDB connected:",
            mongoose.connection.name
        );
        console.log(
            "MongoDB host:",
            mongoose.connection.host
        );

        return mongoose.connection;
    } catch (error) {
        connectionPromise = null;
        throw error;
    }
}

async function disconnectDatabase() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log("MongoDB disconnected");
    }

    connectionPromise = null;
}

module.exports = {
    connectDatabase,
    disconnectDatabase
};
