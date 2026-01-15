// Ajusta datas/flags de ordens marcadas como retroativas.
// Por padrão roda em modo dry-run. Para aplicar: DRY_RUN=false node scripts/fix-retro-dates.js
// Opcional: SHIFT_DAYS=1 para somar um dia às datas (ou -1 para subtrair) se houve deslocamento.

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const SHIFT_DAYS = Number(process.env.SHIFT_DAYS || 0);

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
  const iso = s.slice(0, 10); // yyyy-mm-dd
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

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Iniciando ajuste de ordens retroativas (DRY_RUN=${DRY_RUN}, SHIFT_DAYS=${SHIFT_DAYS})`);
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, date AS order_date, launchDate AS launch_date, isRetroactive AS is_retroactive
         FROM orders
        WHERE COALESCE(isRetroactive, false) = true
        ORDER BY id`
    );

    console.log(`Encontradas ${rows.length} ordens com isRetroactive = true`);

    const updates = [];
    for (const row of rows) {
      const currentDate = toDateOnlyLocal(row.order_date);
      if (!currentDate) {
        console.warn(`Ignorado #${row.id}: data inválida (${row.order_date})`);
        continue;
      }

      const launchDate = toDateOnlyLocal(row.launch_date) || currentDate;
      const targetDate = new Date(currentDate);
      if (SHIFT_DAYS !== 0) {
        targetDate.setDate(targetDate.getDate() + SHIFT_DAYS);
      }

      const newDateStr = formatDate(targetDate);
      const newIsRetro = calculateIsRetroactive(targetDate, launchDate);

      const originalDateStr = formatDate(currentDate);
      const originalIsRetro = Boolean(row.is_retroactive);
      const needsUpdate = newDateStr !== originalDateStr || newIsRetro !== originalIsRetro;

      if (needsUpdate) {
        updates.push({
          id: row.id,
          fromDate: originalDateStr,
          toDate: newDateStr,
          fromRetro: originalIsRetro,
          toRetro: newIsRetro
        });
      }
    }

    console.log(`Registros a atualizar: ${updates.length}`);
    updates.forEach((u) => {
      console.log(
        `#${u.id}: date ${u.fromDate} -> ${u.toDate}; launchDate=${formatDate(
          toDateOnlyLocal(rows.find((r) => r.id === u.id)?.launch_date) || toDateOnlyLocal(rows.find((r) => r.id === u.id)?.order_date) || new Date()
        )}; isRetroactive ${u.fromRetro} -> ${u.toRetro}`
      );
    });

    if (!DRY_RUN && updates.length) {
      for (const u of updates) {
        await client.query(
          `UPDATE orders
              SET date = $1::date,
                  isRetroactive = $2
            WHERE id = $3`,
          [u.toDate, u.toRetro, u.id]
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
    console.error('Erro durante ajuste:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
