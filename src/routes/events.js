import { Router } from "express";
import { ObjectId } from "mongodb";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";

function getDhakaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const dateParts = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

const router = Router();

let db;

export function setEventsDB(database) {
  db = database;
}
const schema = z.object({
  title: z.string().min(4).max(100),
  description: z.string().min(15).max(2000),
  type: z.string().min(2),
  image: z.string().url(),
  location: z.string().min(2),
  date: z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const eventDate = new Date(Date.UTC(year, month - 1, day));

    const isValidDate =
      eventDate.getUTCFullYear() === year &&
      eventDate.getUTCMonth() === month - 1 &&
      eventDate.getUTCDate() === day;

    return isValidDate && value > getDhakaDate();
  }, "Event date must be in the future"),
});

// Get recent upcoming events
router.get("/recent", async (req, res) => {
  const events = await db
    .collection("events")
    .find({
      date: {
        $gt: getDhakaDate(),
      },
    })
    .sort({ date: 1, createdAt: -1 })
    .limit(6)
    .toArray();

  res.json({ events });
});

// Get all upcoming events
router.get("/", async (req, res) => {
  const events = await db
    .collection("events")
    .find({
      date: {
        $gt: new Date().toISOString().slice(0, 10),
      },
    })
    .sort({ date: 1 })
    .toArray();

  res.json({ events });
});

// Get events created by logged-in user
router.get("/mine", requireAuth, async (req, res) => {
  const events = await db
    .collection("events")
    .find({ creatorEmail: req.user.email })
    .sort({ date: 1 })
    .toArray();

  res.json({ events });
});

// Get events joined by logged-in user
router.get("/joined", requireAuth, async (req, res) => {
  const joins = await db
    .collection("joins")
    .find({ userEmail: req.user.email })
    .sort({ eventDate: 1 })
    .toArray();

  const ids = joins.map((j) => new ObjectId(j.eventId));

  const events = await db
    .collection("events")
    .find({ _id: { $in: ids } })
    .sort({ date: 1 })
    .toArray();

  res.json({ events });
});

// Get single event by ID
router.get("/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  const event = await db.collection("events").findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!event) {
    return res.status(404).json({ message: "Event not found" });
  }

  res.json({ event });
});

// Create new event
router.post("/", requireAuth, async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0].message,
    });
  }

  const event = {
    ...parsed.data,
    creatorEmail: req.user.email,
    creatorName: req.user.name,
    createdAt: new Date(),
    joinedCount: 0,
  };

  const result = await db.collection("events").insertOne(event);

  res.status(201).json({
    message: "Event created successfully",
    event: {
      ...event,
      _id: result.insertedId,
    },
  });
});

// Join an event
router.post("/:id/join", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  const event = await db.collection("events").findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!event) {
    return res.status(404).json({ message: "Event not found" });
  }

  if (event.creatorEmail === req.user.email) {
    return res.status(400).json({ message: "You created this event" });
  }

  try {
    await db.collection("joins").insertOne({
      eventId: event._id.toString(),
      eventDate: event.date,
      userEmail: req.user.email,
      userName: req.user.name,
      joinedAt: new Date(),
    });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({
        message: "You already joined this event",
      });
    }

    throw e;
  }

  await db
    .collection("events")
    .updateOne({ _id: event._id }, { $inc: { joinedCount: 1 } });

  res.json({ message: "Joined successfully" });
});

// Update an event
router.patch("/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  const parsed = schema.partial().safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0].message,
    });
  }

  const result = await db.collection("events").updateOne(
    {
      _id: new ObjectId(req.params.id),
      creatorEmail: req.user.email,
    },
    {
      $set: parsed.data,
    },
  );

  if (!result.matchedCount) {
    return res.status(404).json({
      message: "Event not found or not yours",
    });
  }

  res.json({ message: "Event updated" });
});

// Delete an event
router.delete("/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  const id = new ObjectId(req.params.id);

  const result = await db.collection("events").deleteOne({
    _id: id,
    creatorEmail: req.user.email,
  });

  if (!result.deletedCount) {
    return res.status(404).json({
      message: "Event not found or not yours",
    });
  }

  await db.collection("joins").deleteMany({
    eventId: id.toString(),
  });

  res.json({ message: "Event deleted" });
});

export default router;
