import { pool } from "./src/db/pool.js";
import { issueAccountToken } from "./src/modules/account/tokens.js";

const email = process.argv[2] || null;

const result = await pool.query(
  `SELECT u.id, u.email, t.tenant_name
   FROM tenants t
   JOIN users u ON lower(u.email) = lower(t.admin_email)
   WHERE ($1::text IS NULL OR lower(t.admin_email) = lower($1))
   ORDER BY t.created_date DESC
   LIMIT 1`,
  [email]
);

const user = result.rows[0];
if (!user) {
  console.error("NO_USER");
  process.exit(1);
}

const token = await issueAccountToken({
  kind: "invite",
  userId: user.id,
  createdBy: "support",
});

console.log(`EMAIL=${user.email}`);
console.log(`TENANT=${user.tenant_name}`);
console.log(`URL=https://alldebt.clarityib.com.br/aceitar-convite?token=${token.raw}`);
await pool.end();
