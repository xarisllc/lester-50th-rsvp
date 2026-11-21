import { getStore } from "@netlify/blobs";

const STORE_NAME = "lester-50th-rsvps";
const DEFAULT_HOST_KEY = "Xaris50";
const NOTIFY_EMAIL = "lwsimeon@gmail.com";
const DEFAULT_FROM_EMAIL = "Lester 50th RSVP <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Host-Key",
  "Content-Type": "application/json; charset=utf-8",
};

function getEnv(name) {
  const netlifyVal =
    typeof Netlify !== "undefined" && Netlify.env
      ? Netlify.env.get(name)
      : undefined;
  return (netlifyVal || process.env[name] || "").trim();
}

function getExpectedHostKey() {
  return getEnv("HOST_KEY") || DEFAULT_HOST_KEY;
}

function isAuthorizedHost(req, body = {}) {
  const providedKey = String(
    req.headers.get("x-host-key") || body.hostKey || ""
  ).trim();
  return Boolean(providedKey) && providedKey === getExpectedHostKey();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders,
  });
}

function sanitizeRecordFields(body) {
  const name = String(body.name || "").trim().slice(0, 100);
  const attending = Boolean(body.attending);
  const rawGuests = Number.parseInt(body.guests, 10);
  const guests = attending
    ? Math.min(Math.max(Number.isNaN(rawGuests) ? 1 : rawGuests, 1), 20)
    : 0;
  const songRequest = attending
    ? String(body.songRequest || "").trim().slice(0, 140)
    : "";
  const message = String(body.message || "").trim().slice(0, 600);

  return { name, attending, guests, songRequest, message };
}

async function fetchAllEntries(store) {
  const { blobs } = await store.list({ prefix: "rsvp_" });

  return (
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
}

function computeStats(entries) {
  const attendingEntries = entries.filter((item) => item.attending);
  const totalAttendingGuests = attendingEntries.reduce(
    (sum, item) => sum + (Number(item.guests) || 0),
    0
  );

  return {
    totalResponses: entries.length,
    attendingParties: attendingEntries.length,
    declinedParties: entries.length - attendingEntries.length,
    totalAttendingGuests,
  };
}

async function sendRsvpEmail({ record, updated, stats }) {
  const apiKey = getEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY is not set; skipping RSVP email notification.");
    return false;
  }

  const toEmail = getEnv("NOTIFY_EMAIL") || NOTIFY_EMAIL;
  const fromEmail = getEnv("EMAIL_FROM") || DEFAULT_FROM_EMAIL;

  const statusTag = updated ? "Updated RSVP" : "New RSVP";
  const attendanceSummary = record.attending
    ? `Attending (${record.guests} ${record.guests === 1 ? "Guest" : "Guests"})`
    : "Declined";

  const subject = `[${statusTag}] ${record.name} — ${attendanceSummary}`;

  const timestampEt = new Date(record.updatedAt || Date.now()).toLocaleString(
    "en-US",
    {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }
  );

  const badgeBg = record.attending ? "#16402d" : "#b71c2b";
  const html = `
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; background: #fffaf1; border: 2px solid #d9b243; border-radius: 10px; overflow: hidden; color: #241f1b;">
      <div style="background: #16402d; color: #f5de93; padding: 18px 24px; text-align: center;">
        <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">Lester Simeon's 50th Birthday</div>
        <h2 style="margin: 6px 0 0; font-size: 22px; color: #fffaf1;">${escapeHtml(statusTag)} Received</h2>
      </div>
      <div style="padding: 22px 24px; font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6;">
        <p style="margin: 0 0 14px;">
          <span style="display: inline-block; background: ${badgeBg}; color: #ffffff; padding: 5px 12px; border-radius: 999px; font-weight: bold; font-size: 13px;">
            ${escapeHtml(attendanceSummary)}
          </span>
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr>
            <td style="padding: 6px 0; color: #5c5247; width: 135px; vertical-align: top;"><strong>Guest / Family:</strong></td>
            <td style="padding: 6px 0;">${escapeHtml(record.name)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #5c5247; vertical-align: top;"><strong>Response:</strong></td>
            <td style="padding: 6px 0;">${escapeHtml(attendanceSummary)}</td>
          </tr>
          ${
            record.songRequest
              ? `<tr>
                   <td style="padding: 6px 0; color: #5c5247; vertical-align: top;"><strong>Song Request:</strong></td>
                   <td style="padding: 6px 0;">${escapeHtml(record.songRequest)}</td>
                 </tr>`
              : ""
          }
          ${
            record.message
              ? `<tr>
                   <td style="padding: 6px 0; color: #5c5247; vertical-align: top;"><strong>Birthday Note:</strong></td>
                   <td style="padding: 6px 0; font-style: italic;">&ldquo;${escapeHtml(record.message)}&rdquo;</td>
                 </tr>`
              : ""
          }
          <tr>
            <td style="padding: 6px 0; color: #5c5247; vertical-align: top;"><strong>Submitted:</strong></td>
            <td style="padding: 6px 0;">${escapeHtml(timestampEt)}</td>
          </tr>
        </table>
        <div style="background: #f8eedc; border: 1px solid #d9b243; border-radius: 8px; padding: 12px 16px; font-size: 14px;">
          <strong>Current Running Totals:</strong><br />
          Guests Attending: <strong>${stats.totalAttendingGuests}</strong> &bull;
          Parties Attending: <strong>${stats.attendingParties}</strong> &bull;
          Declined: <strong>${stats.declinedParties}</strong>
        </div>
      </div>
    </div>
  `;

  const textLines = [
    `${statusTag} — Lester Simeon's 50th Birthday`,
    "",
    `Guest / Family: ${record.name}`,
    `Response: ${attendanceSummary}`,
    record.songRequest ? `Song Request: ${record.songRequest}` : null,
    record.message ? `Birthday Note: "${record.message}"` : null,
    `Submitted: ${timestampEt}`,
    "",
    `Current Running Totals: ${stats.totalAttendingGuests} guests attending | ${stats.attendingParties} parties attending | ${stats.declinedParties} declined`,
  ].filter(Boolean);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        html,
        text: textLines.join("\n"),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Resend email error:", res.status, errBody);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send RSVP email:", err);
    return false;
  }
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

    // GET: Return full RSVPs for verified Host, or privacy-filtered guestbook for Public
    if (req.method === "GET") {
      const entries = await fetchAllEntries(store);
      const stats = computeStats(entries);
      const hostMode = isAuthorizedHost(req);

      if (hostMode) {
        return jsonResponse({
          hostAuthorized: true,
          entries,
          stats,
        });
      }

      // Public guestbook:
      // - Show attending guests normally
      // - Hide declined guests completely unless they wrote a note
      // - For declined guests who wrote a note, expose ONLY the note (no name, no declined status)
      const publicEntries = [];
      let noteIndex = 0;

      for (const item of entries) {
        if (item.attending) {
          publicEntries.push({
            id: item.id,
            name: item.name,
            attending: true,
            guests: item.guests,
            songRequest: item.songRequest || "",
            message: item.message || "",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            publicNoteOnly: false,
          });
        } else if (item.message && item.message.trim()) {
          noteIndex += 1;
          publicEntries.push({
            id: `note-${noteIndex}`,
            publicNoteOnly: true,
            attending: false,
            message: item.message.trim(),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          });
        }
      }

      return jsonResponse({
        hostAuthorized: false,
        entries: publicEntries,
        stats: {
          attendingParties: stats.attendingParties,
          totalAttendingGuests: stats.totalAttendingGuests,
        },
      });
    }

    // POST: Verify host password OR save a guest RSVP + send email notification
    if (req.method === "POST") {
      const body = await req.json();

      if (body.action === "verify-host") {
        if (!isAuthorizedHost(req, body)) {
          return jsonResponse({ error: "Incorrect host password." }, 401);
        }
        return jsonResponse({ success: true, authorized: true });
      }

      const { name, attending, guests, songRequest, message } =
        sanitizeRecordFields(body);
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

      // Compute updated totals and send email notification to lwsimeon@gmail.com
      const allEntries = await fetchAllEntries(store);
      const updatedStats = computeStats(allEntries);
      const emailSent = await sendRsvpEmail({
        record,
        updated: Boolean(existing),
        stats: updatedStats,
      });

      return jsonResponse({
        success: true,
        updated: Boolean(existing),
        entry: record,
        emailSent,
      });
    }

    // PUT: Host-only edit/customization of any RSVP entry
    if (req.method === "PUT") {
      const body = await req.json();

      if (!isAuthorizedHost(req, body)) {
        return jsonResponse({ error: "Unauthorized host password." }, 401);
      }

      const id = slugify(body.id);
      if (!id) {
        return jsonResponse({ error: "Missing RSVP ID." }, 400);
      }

      const { name, attending, guests, songRequest, message } =
        sanitizeRecordFields(body);

      if (!name) {
        return jsonResponse({ error: "Guest name cannot be empty." }, 400);
      }

      const key = `rsvp_${id}`;
      const existing = await store.get(key, { type: "json" });
      if (!existing) {
        return jsonResponse({ error: "RSVP entry not found." }, 404);
      }

      const record = {
        ...existing,
        id,
        name,
        attending,
        guests,
        songRequest,
        message,
        updatedAt: new Date().toISOString(),
      };

      await store.setJSON(key, record);

      return jsonResponse({
        success: true,
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

      if (!isAuthorizedHost(req, body)) {
        return jsonResponse({ error: "Unauthorized host password." }, 401);
      }

      const url = new URL(req.url);
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
