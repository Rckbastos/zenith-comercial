// Script para recalcular ordens existentes usando a lógica atual do server.js
// Uso: DATABASE_URL=... node recalc-orders.js
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL para conectar ao banco.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')
    ? { rejectUnauthorized: false }
    : false
});

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao buscar ${url}: ${res.status}`);
  return res.json();
}

async function fetchUsdtQuote() {
  try {
    const data = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL');
    const price = Number(data?.price);
    return Number.isFinite(price) ? price : 0;
  } catch (err) {
    console.error('Erro ao buscar cotação USDT:', err.message);
    return 0;
  }
}

function calcCost(price, service, opts = {}) {
  if (!service) return 0;
  const costType = service.costType ?? service.costtype;
  const costFixo = Number(service.costFixo ?? service.costfixo ?? 0);
  const costPercentual = Number(service.costPercentual ?? service.costpercentual ?? 0);

  if (costType === 'fixo') return costFixo || 0;
  if (costType === 'percentual') return price * (costPercentual / 100);
  if (costType === 'fixo_percentual') return costFixo + price * (costPercentual / 100);
  if (costType === 'cotacao_percentual') {
    const quote = Number(opts.quote) || 0;
    const qty = Number(opts.quantity) || 0;
    const unitCost = quote + (quote * costPercentual / 100);
    return qty > 0 ? unitCost * qty : unitCost;
  }
  return 0;
}

async function computeFinancials(order, seller, service) {
  const rawQty = Number(order.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 0;

  const priceFromPayload = Number(order.price) || 0;
  const servicePrice = service ? Number(service.price ?? 0) : 0;
  const invoiceUsd = Number(order.invoiceUsd ?? order.invoiceusd ?? 0);
  const historicalQuote = Number(order.historicalQuote ?? order.historicalquote ?? 0) || null;

  const unitPriceRaw = Number(order.unitPrice ?? order.pricePerUnit ?? order.unitprice);
  let unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
    ? unitPriceRaw
    : (Number.isFinite(servicePrice) && servicePrice > 0 ? servicePrice : 0);

  if (!unitPrice && priceFromPayload > 0 && quantity > 0) {
    unitPrice = priceFromPayload / quantity;
  }

  const serviceName = (service?.name || order.productType || '').toString().trim().toLowerCase();
  const isRemessa = serviceName === 'remessa';
  if (isRemessa) {
    let quote;
    if (historicalQuote != null && historicalQuote > 0) {
      quote = historicalQuote;
    } else {
      quote = await fetchUsdtQuote();
      if (!Number.isFinite(quote) || quote <= 0) {
        quote = Number(unitPrice) || (priceFromPayload / (quantity || 1)) || 5.5;
      }
    }
    const spreadPercent = Number(service?.costPercentual ?? 0.80);
    const quoteWithSpread = quote + (quote * spreadPercent / 100);

    const price = priceFromPayload > 0 ? priceFromPayload : unitPrice * quantity;
    const custoBase = quoteWithSpread * quantity;
    const fixedUsdFee = Number.isFinite(Number(service?.costFixo)) ? Number(service.costFixo) : 25;
    const taxaFixaConvertida = fixedUsdFee * quote;
    const invoiceTax = invoiceUsd > 0 ? invoiceUsd * quote : 0;
    const cost = custoBase + taxaFixaConvertida + invoiceTax;
    const profit = price - cost;
    const commissionRate = seller ? Number(seller.commission || 0) : 0;
    const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

    return {
      price,
      cost,
      profit,
      commissionValue,
      quoteUsed: quote,
      unitPriceUsed: unitPrice || quote
    };
  }

  const serviceCostType = service?.costType ?? service?.costtype;
  let quote = null;
  if (historicalQuote != null && historicalQuote > 0) {
    quote = historicalQuote;
  } else if (serviceCostType === 'cotacao_percentual') {
    quote = await fetchUsdtQuote();
  }
  const fallbackQuote = unitPrice;
  if (!Number.isFinite(quote) || quote <= 0) quote = fallbackQuote;

  const price = priceFromPayload > 0 ? priceFromPayload : unitPrice * quantity;

  let cost = 0;
  if (service) {
    if (serviceCostType === 'cotacao_percentual') {
      const pct = Number(service.costPercentual ?? service.costpercentual ?? 0);
      const unitCost = quote + (quote * pct / 100);
      cost = unitCost * quantity;
    } else {
      cost = calcCost(price, service, { quote: quote || fallbackQuote, quantity });
    }
  } else if (order.cost != null) {
    cost = Number(order.cost);
  }

  const profit = price - cost;
  const commissionRate = seller ? Number(seller.commission || 0) : 0;
  const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

  return {
    price,
    cost,
    profit,
    commissionValue,
    quoteUsed: (Number.isFinite(quote) && quote > 0) ? quote : (Number.isFinite(fallbackQuote) ? fallbackQuote : null),
    unitPriceUsed: unitPrice
  };
}

async function run() {
  const client = await pool.connect();
  try {
    const ordersRes = await client.query('SELECT * FROM orders');
    const servicesRes = await client.query('SELECT * FROM services');
    const usersRes = await client.query('SELECT * FROM users');

    const servicesMap = Object.fromEntries(servicesRes.rows.map(s => [s.id, s]));
    const usersMap = Object.fromEntries(usersRes.rows.map(u => [u.id, u]));

    let updated = 0;
    for (const row of ordersRes.rows) {
      const service = servicesMap[row.serviceid];
      const seller = usersMap[row.sellerid];
      const calc = await computeFinancials(row, seller, service);

      await client.query(
        `UPDATE orders
         SET unitPrice=$1, quote=$2, price=$3, cost=$4, profit=$5, commissionValue=$6
         WHERE id=$7`,
        [
          calc.unitPriceUsed ?? null,
          calc.quoteUsed ?? null,
          calc.price ?? 0,
          calc.cost ?? 0,
          calc.profit ?? 0,
          calc.commissionValue ?? 0,
          row.id
        ]
      );
      updated += 1;
    }

    console.log(`Recalculadas ${updated} ordens.`);
  } catch (err) {
    console.error('Erro ao recalcular ordens:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
