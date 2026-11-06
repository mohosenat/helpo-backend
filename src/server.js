import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { toNodeHandler } from "better-auth/node";
import eventsRouter, { setEventsDB } from "./routes/events.js";

const app = express();

const client = new MongoClient(process.env.MONGODB_URI);

await client.connect();

const db = client.db();

console.log("MongoDB connected");

const auth = betterAuth({
  database: mongodbAdapter(db),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret: process.env.BETTER_AUTH_SECRET,

  advanced: {
    useSecureCookies: true,

    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },

  plugins: [
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }),
      },
    }),
  ],

  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
});

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

await db.collection("event participants").createIndex(
  { eventId: 1, userEmail: 1 },
  {
    unique: true,
    name: "unique_event_user_join",
  },
);

setEventsDB(db);

app.get("/", (req, res) => {
  res.send("Helpo Server is running!");
});

app.get("/api/health", (req, res) =>
  res.json({
    status: "ok",
    service: "Helpo API",
  }),
);

app.use("/api/events", eventsRouter);

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    message: "Internal server error",
  });
});

export default app;

if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 5000;

  app.listen(port, () => {
    console.log(`Server is running on ${port}`);
  });
}
