import pg from "pg";

const { Client } = pg;
const {
  DATABASE_BREAK_GLASS_URL,
  BREAK_GLASS_TICKET,
  BREAK_GLASS_REASON,
  BREAK_GLASS_CONFIRMATION
} = process.env;

if (BREAK_GLASS_CONFIRMATION !== "I_UNDERSTAND_BREAK_GLASS") {
  throw new Error(
    "Set BREAK_GLASS_CONFIRMATION=I_UNDERSTAND_BREAK_GLASS to record break-glass access."
  );
}
if (!DATABASE_BREAK_GLASS_URL || !BREAK_GLASS_TICKET || !BREAK_GLASS_REASON) {
  throw new Error(
    "DATABASE_BREAK_GLASS_URL, BREAK_GLASS_TICKET, and BREAK_GLASS_REASON are required."
  );
}

const client = new Client({ connectionString: DATABASE_BREAK_GLASS_URL });
await client.connect();
try {
  await client.query(
    `INSERT INTO flowdesk_meta.break_glass_access_log (change_ticket, reason, confirmation)
     VALUES ($1, $2, 'BREAK_GLASS_CONFIRMED')`,
    [BREAK_GLASS_TICKET, BREAK_GLASS_REASON]
  );
  console.log("break-glass access recorded");
} finally {
  await client.end();
}
