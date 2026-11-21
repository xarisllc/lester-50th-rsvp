import { getStore } from "@netlify/blobs";

const STORE_NAME = "lester-50th-rsvps";
const DEFAULT_HOST_KEY = "lester50";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Host-Key",
  "Content-Type": "application/json; charset=utf-8",
};

function getExpectedHostKey() {
  const netlifyEnv =
    typeof Netlify !== "undefined" && Netlify.env
      ? Netlify.env.get("HOST_KEY")
      : undefined;
  return (netlifyEnv || process.env.HOST_KEY || DEFAULT_HOST_KEY).trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders,
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const store = getStore({
      name: STORE_NAME,
      consistency: "strong",
    });

    // GET: Return all saved RSVPs and summary stats
    if (req.method === "GET") {
      const { blobs } = await store.list({ prefix: "rsvp_" });

      const entries = (
        await Promise.all(
          blobs.map(async (blob) => {
            try {
              return await store.get(blob.key, { type: "json" });
            } catch {
              return null;
            }
          })
        )
      )
        .filter(Boolean)
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );

      const attendingEntries = entries.filter((item) => item.attending);
      const totalAttendingGuests = attendingEntries.reduce(
        (sum, item) => sum + (Number(item.guests) || 0),
        0
      );

      return jsonResponse({
        entries,
        stats: {
          totalResponses: entries.length,
          attendingParties: attendingEntries.length,
          declinedParties: entries.length - attendingEntries.length,
          totalAttendingGuests,
        },
      });
    }

    // POST: Save or update an RSVP entry
    if (req.method === "POST") {
      const body = await req.json();

      const name = String(body.name || "").trim().slice(0, 100);
      const attending = Boolean(body.attending);
      const rawGuests = Number.parseInt(body.guests, 10);
      const guests = attending
        ? Math.min(Math.max(Number.isNaN(rawGuests) ? 1 : rawGuests, 1), 20)
        : 0;
      const songRequest = String(body.songRequest || "").trim().slice(0, 140);
      const message = String(body.message || "").trim().slice(0, 600);
      const inviteId = slugify(body.inviteId);

      if (!name) {
        return jsonResponse({ error: "Please enter your name." }, 400);
      }

      const slug = inviteId || slugify(name) || `guest-${Date.now()}`;
      const key = `rsvp_${slug}`;

      const existing = await store.get(key, { type: "json" });
      const now = new Date().toISOString();

      const record = {
        id: slug,
        name,
        attending,
        guests,
        songRequest,
        message,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await store.setJSON(key, record);

      return jsonResponse({
        success: true,
        updated: Boolean(existing),
        entry: record,
      });
    }

    // DELETE: Host-only removal of an RSVP entry
    if (req.method === "DELETE") {
      let body = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const url = new URL(req.url);
      const providedKey = String(
        req.headers.get("x-host-key") || body.hostKey || ""
      ).trim();

      if (providedKey !== getExpectedHostKey()) {
        return jsonResponse({ error: "Invalid host PIN." }, 401);
      }

      const id = slugify(body.id || url.searchParams.get("id"));
      if (!id) {
        return jsonResponse({ error: "Missing RSVP ID." }, 400);
      }

      await store.delete(`rsvp_${id}`);

      return jsonResponse({
        success: true,
        deletedId: id,
      });
    }

    return jsonResponse({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("save-data function error:", error);
    return jsonResponse(
      { error: "Unable to process RSVP right now. Please try again." },
      500
    );
  }
};
