import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "./src/db/pool.js";
import { config } from "./src/config.js";
import { issueAccountToken } from "./src/modules/account/tokens.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("usage: node provision-owner-invite.mjs <admin_email>");
  process.exit(1);
}

const tenantRes = await pool.query(
  `SELECT id, group_id, tenant_name, admin_email, responsible_name
   FROM tenants
   WHERE lower(COALESCE(admin_email, owner_email, '')) = lower($1)
   ORDER BY created_date DESC
   LIMIT 1`,
  [email]
);
const tenant = tenantRes.rows[0];
if (!tenant) {
  console.error("NO_TENANT");
  process.exit(1);
}

const fullName = tenant.responsible_name || email.split("@")[0] || "Administrador";
let userRes = await pool.query(`SELECT id, email, full_name FROM users WHERE lower(email) = lower($1)`, [email]);
let user = userRes.rows[0];
let created = false;

if (!user) {
  const id = randomUUID();
  const hash = await bcrypt.hash(randomBytes(24).toString("hex"), config.bcryptRounds);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status, blocked, created_by)
     VALUES ($1,$2,$3,$4,'admin','active',FALSE,'support')`,
    [id, email, hash, fullName]
  );
  user = { id, email, full_name: fullName };
  created = true;
}

await pool.query(
  `INSERT INTO tenant_users (id, tenant_id, group_id, user_email, role, joined_at, created_by)
   VALUES ($1,$2,$3,$4,'OWNER',now(),'support')
   ON CONFLICT (tenant_id, user_email) DO UPDATE SET role = 'OWNER', updated_date = now()`,
  [`tuser_${user.id.replaceAll("-", "").slice(0, 12)}`, tenant.id, tenant.group_id, email]
);

const token = await issueAccountToken({ kind: "invite", userId: user.id, createdBy: "support" });
const url = `https://alldebt.clarityib.com.br/aceitar-convite?token=${token.raw}`;

console.log(`TENANT=${tenant.tenant_name}`);
console.log(`EMAIL=${email}`);
console.log(`USER_CREATED=${created}`);
console.log(`URL=${url}`);
await pool.end();
