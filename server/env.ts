// Loads .env before any other server module reads process.env.
// Keep this module free of other imports so it can be evaluated first.
import dotenv from "dotenv";

dotenv.config();
