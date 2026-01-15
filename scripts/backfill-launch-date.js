// Preenche launchDate e recalcula isRetroactive com base em date < launchDate.
// Uso: DRY_RUN=true DATABASE_URL=... node scripts/backfill-launch-date.js
// DRY_RUN=false para aplicar.

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

if (!connectionString) {
  console.error('DATABASE_URL não configurado. Abortei.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

function toDateOnlyLocal(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const s = String(value).trim();
  const iso = s.slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function calculateIsRetroactive(orderDateValue, launchDateValue) {
  const orderDate = toDateOnlyLocal(orderDateValue);
  const launchDate = toDateOnlyLocal(launchDateValue);
  if (!orderDate || !launchDate) return false;
  return orderDate.getTime() < launchDate.getTime();
}

async function hasCreatedAt(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('created_at','createdat') LIMIT 1`
  );
  return rows.length > 0;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Backfill launchDate (DRY_RUN=${DRY_RUN})`);
    await client.query('BEGIN');

    const createdExists = await hasCreatedAt(client);

    const selectSql = createdExists
      ? `SELECT id, date AS order_date, isRetroactive, launchDate, created_at FROM orders WHERE launchDate IS NULL ORDER BY id`
      : `SELECT id, date AS order_date, isRetroactive, launchDate FROM orders WHERE launchDate IS NULL ORDER BY id`;

    const { rows } = await client.query(selectSql);
    console.log(`Encontradas ${rows.length} ordens sem launchDate`);

    const today = new Date();
    const updates = [];

    for (const row of rows) {
      const orderDate = toDateOnlyLocal(row.order_date);
      if (!orderDate) {
        console.warn(`Ignorando #${row.id}: date inválida (${row.order_date})`);
        continue;
      }

      const launchCandidate =
        (createdExists && toDateOnlyLocal(row.created_at)) ||
        orderDate ||
        today;

      const launchDateStr = formatDate(launchCandidate);
      const newIsRetro = calculateIsRetroactive(orderDate, launchCandidate);
      const originalIsRetro = Boolean(row.isretroactive ?? row.isRetroactive);

      updates.push({
        id: row.id,
        launchDate: launchDateStr,
        isRetroactive: newIsRetro,
        originalIsRetro
      });
    }

    console.log(`Registros a atualizar: ${updates.length}`);
    updates.forEach((u) => {
      console.log(`#${u.id}: launchDate -> ${u.launchDate}; isRetroactive ${u.originalIsRetro} -> ${u.isRetroactive}`);
    });

    if (!DRY_RUN && updates.length) {
      for (const u of updates) {
        await client.query(
          `UPDATE orders SET launchDate=$1::date, isRetroactive=$2 WHERE id=$3`,
          [u.launchDate, u.isRetroactive, u.id]
        );
      }
      await client.query('COMMIT');
      console.log(`Atualizados ${updates.length} registros.`);
    } else {
      await client.query('ROLLBACK');
      console.log('DRY RUN: nenhuma alteração aplicada.');
    }
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Erro no backfill:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
