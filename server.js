const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL não definido. Configure no Railway para persistir dados.');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')
    ? { rejectUnauthorized: false }
    : false
});

// Hash padrão para os usuários de exemplo
const DEFAULT_PASSWORD = 'Senhaexemplo123';
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
const MASTER_PASSWORD = 'Senha@123';
const MASTER_PASSWORD_HASH = bcrypt.hashSync(MASTER_PASSWORD, 10);

async function runMigrations() {
  // adiciona colunas novas sem quebrar deploys anteriores
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS quantity NUMERIC(14,4) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payoutProof TEXT,
      ADD COLUMN IF NOT EXISTS wallet TEXT,
      ADD COLUMN IF NOT EXISTS quote NUMERIC(14,6),
      ADD COLUMN IF NOT EXISTS unitPrice NUMERIC(14,6),
      ADD COLUMN IF NOT EXISTS invoiceUsd NUMERIC(14,4) DEFAULT 0;
  `);

  await query(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL';
  `);
}

// aceita payloads maiores (comprovantes base64)
app.use(express.json({ limit: '6mb' }));

// CSP para permitir Google Fonts e Binance API
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://api.binance.com",
      "manifest-src 'self'"
    ].join('; ')
  );
  next();
});

app.use(express.static(__dirname));

// Rotas explícitas para HTML principais (evita 404/redirect em produção)
app.get(['/', '/index', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/zenith-admin-completo.html', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'zenith-admin-completo.html'));
});

app.get('/zenith-gerente-completo.html', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'zenith-gerente-completo.html'));
});

app.get(['/login-admin', '/login-admin.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'login-admin.html'));
});

app.get(['/login-gerente', '/login-gerente.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'login-gerente.html'));
});

// Rotas sem extensão servindo direto o HTML
app.get('/zenith-admin-completo', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'zenith-admin-completo.html'));
});

app.get('/zenith-gerente-completo', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'zenith-gerente-completo.html'));
});

// Fallback para outras rotas (exceto API e assets), retorna index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.includes('.')) return next();
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function fetchUsdtQuote() {
  try {
    console.log('🔄 Consultando Binance API USDTBRL...');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const price = Number(data?.price);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Cotação inválida: ${data?.price}`);
    }

    console.log('✅ Cotação USDT Binance:', price.toFixed(4));
    return price;

  } catch (err) {
    console.error('❌ ERRO ao buscar cotação USDT:', err.message);

    try {
      console.log('🔄 Tentando API alternativa (Mercado Bitcoin)...');
      const resMB = await fetch('https://www.mercadobitcoin.net/api/USDT/ticker/');
      const dataMB = await resMB.json();
      const priceMB = Number(dataMB?.ticker?.last);

      if (Number.isFinite(priceMB) && priceMB > 0) {
        console.log('✅ Cotação USDT (Mercado Bitcoin):', priceMB.toFixed(4));
        return priceMB;
      }
    } catch (errMB) {
      console.error('❌ API alternativa também falhou:', errMB.message);
    }

    throw new Error('Todas as APIs de cotação USDT estão indisponíveis');
  }
}

async function fetchUsdQuote() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDBRL');
    const data = await res.json();
    const price = Number(data?.price);
    return Number.isFinite(price) ? price : 0;
  } catch (err) {
    console.error('Erro ao buscar cotação USD:', err.message);
    return 0;
  }
}

function calcCost(price, service, opts = {}) {
  if (!service) return 0;
  const costType = service.costType ?? service.costtype;
  const costFixo = Number(service.costFixo ?? service.costfixo ?? 0);
  const costPercentual = Number(service.costPercentual ?? service.costpercentual ?? 0);

  if (costType === 'fixo') {
    return costFixo || 0;
  }
  if (costType === 'percentual') {
    return price * (costPercentual / 100);
  }
  if (costType === 'fixo_percentual') {
    return costFixo + price * (costPercentual / 100);
  }
  if (costType === 'cotacao_percentual') {
    const quote = Number(opts.quote) || 0;
    const qty = Number(opts.quantity) || 0;
    const unitCost = quote * (1 + (costPercentual / 100));
    return qty > 0 ? unitCost * qty : unitCost;
  }
  return 0;
}

async function computeFinancials(order, seller, service) {
  const rawQty = Number(order.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 0;

  const priceFromPayload = Number(order.price) || 0; // pode ser total informado
  const servicePrice = service ? Number(service.price ?? 0) : 0;
  const invoiceUsd = Number(order.invoiceUsd ?? order.invoiceusd ?? 0);

  // Preço unitário informado (preço fechado por USDT)
  const unitPriceRaw = Number(order.unitPrice ?? order.pricePerUnit);
  let unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
    ? unitPriceRaw
    : (Number.isFinite(servicePrice) && servicePrice > 0 ? servicePrice : 0);

  if (!unitPrice && priceFromPayload > 0 && quantity > 0) {
    unitPrice = priceFromPayload / quantity; // deriva unitário apenas se não veio
  }

  // Regra específica apenas para o serviço "Remessa": custo = (cotação + 0,30%) * qtd + 25 USD
  const serviceName = (service?.name || order.productType || '').toString().trim().toLowerCase();
  const isRemessa = serviceName === 'remessa';
  if (isRemessa) {
    console.log('🔍 ===== COMPUTANDO REMESSA =====');
    console.log('order.quantity:', order.quantity);
    console.log('order.unitPrice:', order.unitPrice);
    console.log('order.price:', order.price);
    console.log('order.invoiceUsd:', invoiceUsd);

    let quote;
    try {
      quote = await fetchUsdtQuote();
    } catch (err) {
      console.error('⚠️ Impossível criar ordem sem cotação USDT:', err.message);
      throw new Error('Cotação USDT indisponível. Aguarde e tente novamente.');
    }

    const spreadPercent = Number(service?.costPercentual ?? 1.2);
    const spreadEmReais = quote * (spreadPercent / 100);
    const cotacaoFinal = quote + spreadEmReais;
    const quantidadeTotal = quantity + invoiceUsd;
    const cost = quantidadeTotal * cotacaoFinal;
    const price = priceFromPayload > 0 ? priceFromPayload : unitPrice * quantity;
    const profit = price - cost;
    const commissionRate = seller ? Number(seller.commission || 0) : 0;
    const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

    console.log('=== DEBUG REMESSA ===');
    console.log('quantity (USDT):', quantity.toFixed(2));
    console.log('invoice (USD):', invoiceUsd.toFixed(2));
    console.log('quantidade_total:', quantidadeTotal.toFixed(2));
    console.log('cotação_binance:', quote.toFixed(4));
    console.log('spread (%):', spreadPercent);
    console.log('spread (R$):', spreadEmReais.toFixed(4));
    console.log('cotação_final:', cotacaoFinal.toFixed(4));
    console.log('cost:', cost.toFixed(2));
    console.log('price:', price.toFixed(2));
    console.log('profit:', profit.toFixed(2));
    console.log('====================');

    return {
      price,
      cost,
      profit,
      commissionValue,
      quoteUsed: cotacaoFinal,
      unitPriceUsed: unitPrice || cotacaoFinal
    };
  }

  const serviceCostType = service?.costType ?? service?.costtype;
  let quote = null;
  if (serviceCostType === 'cotacao_percentual') {
    quote = await fetchUsdtQuote();
  }
  const fallbackQuote = unitPrice;
  if (!Number.isFinite(quote) || quote <= 0) quote = fallbackQuote;

  // Preço de venda total (o que o cliente paga)
  const price = priceFromPayload > 0 ? priceFromPayload : unitPrice * quantity;

  // Custo de compra
  let cost = 0;
  if (service) {
    if (serviceCostType === 'cotacao_percentual') {
      const pct = Number(service.costPercentual ?? service.costpercentual ?? 0);
      const unitCost = quote * (1 + pct / 100);
      cost = unitCost * quantity;
    } else {
      cost = calcCost(price, service, { quote: quote || fallbackQuote, quantity });
    }
  } else if (order.cost != null) {
    cost = Number(order.cost);
  }

  const profit = price - cost; // lucro = venda - custo
  const commissionRate = seller ? Number(seller.commission || 0) : 0;
  const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

  console.log('=== DEBUG ORDEM ===');
  console.log('quantity:', quantity);
  console.log('quote:', quote);
  if (serviceCostType === 'cotacao_percentual') {
    const pct = Number(service.costPercentual ?? service.costpercentual ?? 0);
    const unitCost = quote * (1 + pct / 100);
    console.log('unitCost:', unitCost);
  }
  console.log('cost (total):', cost);
  console.log('unitPrice:', unitPrice);
  console.log('price (total):', price);
  console.log('profit:', profit);
  console.log('===================');

  return {
    price,
    cost,
    profit,
    commissionValue,
    quoteUsed: (Number.isFinite(quote) && quote > 0) ? quote : (Number.isFinite(fallbackQuote) ? fallbackQuote : null),
    unitPriceUsed: unitPrice
  };
}

// Normalizadores para manter camelCase na API (PG devolve colunas em minúsculo)
function normalizeUser(row = {}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    commission: Number(row.commission ?? 0),
    status: row.status
  };
}

function normalizeService(row = {}) {
  return {
    id: row.id,
    name: row.name,
    costType: row.costType ?? row.costtype,
    costFixo: Number(row.costFixo ?? row.costfixo ?? 0),
    costPercentual: Number(row.costPercentual ?? row.costpercentual ?? 0),
    price: Number(row.price ?? 0),
    status: row.status,
    currency: row.currency || 'BRL',
    description: row.description
  };
}

function normalizeOrder(row = {}) {
  return {
    id: row.id,
    customer: row.customer,
    sellerId: row.sellerId ?? row.sellerid,
    serviceId: row.serviceId ?? row.serviceid,
    quantity: Number(row.quantity ?? 0),
    unitPrice: row.unitprice != null ? Number(row.unitprice) : (row.unitPrice != null ? Number(row.unitPrice) : undefined),
    quote: row.quote != null ? Number(row.quote) : undefined,
    invoiceUsd: row.invoiceusd != null ? Number(row.invoiceusd) : (row.invoiceUsd != null ? Number(row.invoiceUsd) : 0),
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    profit: Number(row.profit ?? 0),
    commissionValue: Number(row.commissionValue ?? row.commissionvalue ?? 0),
    date: row.date,
    status: row.status,
    commissionPaid: row.commissionPaid ?? row.commissionpaid,
    productType: row.productType ?? row.producttype,
    payoutProof: row.payoutProof ?? row.payoutproof,
    wallet: row.wallet
  };
}

function normalizeAssignment(row = {}) {
  return {
    id: row.id,
    userId: row.userId ?? row.userid,
    serviceId: row.serviceId ?? row.serviceid,
    username: row.username,
    role: row.role,
    serviceName: row.serviceName ?? row.servicename
  };
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      role TEXT,
      commission NUMERIC(5,2) DEFAULT 0,
      status TEXT DEFAULT 'Ativo'
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      costType TEXT,
      costFixo NUMERIC(14,2) DEFAULT 0,
      costPercentual NUMERIC(7,4) DEFAULT 0,
      price NUMERIC(14,2) DEFAULT 0,
      status TEXT DEFAULT 'Ativo',
      currency TEXT DEFAULT 'BRL',
      description TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer TEXT,
      sellerId INT REFERENCES users(id),
      serviceId INT REFERENCES services(id),
      invoiceUsd NUMERIC(14,4) DEFAULT 0,
      price NUMERIC(14,2) DEFAULT 0,
      cost NUMERIC(14,2) DEFAULT 0,
      profit NUMERIC(14,2) DEFAULT 0,
      commissionValue NUMERIC(14,2) DEFAULT 0,
      date DATE DEFAULT CURRENT_DATE,
      status TEXT DEFAULT 'open',
      commissionPaid BOOLEAN DEFAULT false,
      productType TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      userId INT REFERENCES users(id) ON DELETE CASCADE,
      serviceId INT REFERENCES services(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(userId, serviceId)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id SERIAL PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      target TEXT NOT NULL
    );
  `);

  const authCount = (await query('SELECT COUNT(*)::int AS count FROM auth_accounts'))[0].count;
  if (authCount === 0) {
    await query(
      `INSERT INTO auth_accounts (login, email, password_hash, role, target) VALUES
      ('Rckbastos', 'ricardob1720@gmail.com', $1, 'gerente', '/zenith-gerente-completo.html'),
      ('admin', 'admin@teste.com', $1, 'admin', '/zenith-admin-completo.html'),
      ('ricardob@email.com', 'ricardob@email.com', $1, 'admin', '/zenith-admin-completo.html')`,
      [DEFAULT_PASSWORD_HASH]
    );
  }

  // Garante usuário master admin (login: admin, senha: Senha@123)
  await query(
    `INSERT INTO auth_accounts (login, email, password_hash, role, target)
     VALUES ('admin', 'master@zenith.com', $1, 'admin', '/zenith-admin-completo.html')
     ON CONFLICT (login) DO UPDATE
       SET email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           target = EXCLUDED.target`,
    [MASTER_PASSWORD_HASH]
  );
}

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', env: process.env.NODE_ENV || 'development', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Users
app.get('/api/users', async (_req, res) => {
  const rows = await query('SELECT * FROM users ORDER BY id');
  res.json(rows.map(normalizeUser));
});

app.post('/api/users', async (req, res) => {
  const body = req.body || {};
  const authLogin = body.login || body.email || body.name;
  const roleLower = (body.role || '').toLowerCase();
  const authRole = roleLower.includes('admin') ? 'admin' : 'gerente';
  const authTarget = authRole === 'gerente' ? '/zenith-gerente-completo.html' : '/zenith-admin-completo.html';

  const rows = await query(
    `INSERT INTO users (name, email, phone, role, commission, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.name, body.email, body.phone, body.role, body.commission || 0, body.status || 'Ativo']
  );

  // Se vier senha, cria/atualiza credencial de login usando email como login
  if (body.password) {
    const passwordHash = bcrypt.hashSync(body.password, 10);
    await query(
      `INSERT INTO auth_accounts (login, email, password_hash, role, target)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (login) DO UPDATE
         SET email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             target = EXCLUDED.target`,
      [authLogin, body.email, passwordHash, authRole, authTarget]
    );
  }

  res.status(201).json(normalizeUser(rows[0]));
});

app.put('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rows = await query(
    `UPDATE users SET name=$1, email=$2, phone=$3, role=$4, commission=$5, status=$6 WHERE id=$7 RETURNING *`,
    [body.name, body.email, body.phone, body.role, body.commission || 0, body.status || 'Ativo', id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(normalizeUser(rows[0]));
});

app.delete('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('DELETE FROM assignments WHERE userId=$1', [id]);
    await query('UPDATE orders SET sellerId = NULL WHERE sellerId=$1', [id]);
    await query('DELETE FROM users WHERE id=$1', [id]);
    res.status(204).end();
  } catch (err) {
    console.error('Erro ao excluir usuário', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Services
app.get('/api/services', async (_req, res) => {
  const rows = await query('SELECT * FROM services ORDER BY id');
  res.json(rows.map(normalizeService));
});

app.post('/api/services', async (req, res) => {
  const body = req.body || {};
  const rows = await query(
    `INSERT INTO services (name, costType, costFixo, costPercentual, price, status, currency, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.currency || 'BRL', body.description || '']
  );
  res.status(201).json(normalizeService(rows[0]));
});

app.put('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rows = await query(
    `UPDATE services SET name=$1, costType=$2, costFixo=$3, costPercentual=$4, price=$5, status=$6, currency=$7, description=$8 WHERE id=$9 RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.currency || 'BRL', body.description || '', id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(normalizeService(rows[0]));
});

app.delete('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    // Remove vínculos e libera ordens antes de excluir o serviço
    await query('DELETE FROM assignments WHERE serviceId=$1', [id]);
    await query('UPDATE orders SET serviceId = NULL WHERE serviceId=$1', [id]);
    await query('DELETE FROM services WHERE id=$1', [id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assignments
app.get('/api/assignments', async (_req, res) => {
  const rows = await query(`
    SELECT a.id, a.userid, a.serviceid, u.name AS username, u.role, s.name AS servicename
    FROM assignments a
    JOIN users u ON u.id = a.userId
    JOIN services s ON s.id = a.serviceId
    ORDER BY u.name, s.name
  `);
  res.json(rows.map(normalizeAssignment));
});

app.post('/api/assignments', async (req, res) => {
  const body = req.body || {};
  const userId = Number(body.userId);
  const serviceId = Number(body.serviceId);
  if (!userId || !serviceId) return res.status(400).json({ error: 'userId e serviceId são obrigatórios' });
  try {
    const rows = await query(
      `INSERT INTO assignments (userId, serviceId) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`,
      [userId, serviceId]
    );
    if (!rows.length) {
      return res.status(200).json({ message: 'Já atribuído' });
    }
    res.status(201).json(normalizeAssignment(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assignments/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM assignments WHERE id=$1', [id]);
  res.status(204).end();
});

// Orders
app.get('/api/orders', async (_req, res) => {
  const rows = await query('SELECT * FROM orders ORDER BY id DESC');
  const services = await query('SELECT * FROM services');
  const users = await query('SELECT * FROM users');
  const servicesMap = Object.fromEntries(services.map(s => [s.id, normalizeService(s)]));
  const servicesByName = services
    .map(normalizeService)
    .reduce((acc, svc) => {
      if (svc.name) acc[svc.name.toLowerCase()] = svc;
      return acc;
    }, {});
  const usersMap = Object.fromEntries(users.map(u => [u.id, normalizeUser(u)]));

  const enriched = await Promise.all(rows.map(async (row) => {
    const order = normalizeOrder(row);
    let service = servicesMap[order.serviceId];
    if (!service && order.productType) {
      service = servicesByName[order.productType.toLowerCase()];
    }
    const seller = usersMap[order.sellerId];
    // Recalcula sempre para garantir consistência com a lógica atual
    const calc = await computeFinancials({ ...order, price: order.price }, seller, service);
    return { ...order, ...calc, quote: calc.quoteUsed, unitPrice: calc.unitPriceUsed };
  }));

  res.json(enriched);
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
    const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

    const { price, cost, profit, commissionValue, quoteUsed, unitPriceUsed } = await computeFinancials(body, seller, service);

    const rows = await query(
      `INSERT INTO orders (customer, sellerId, serviceId, quantity, unitPrice, quote, price, cost, profit, commissionValue, date, status, commissionPaid, productType, payoutProof, wallet, invoiceUsd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        body.customer,
        body.sellerId || null,
        body.serviceId || null,
        body.quantity || 0,
        unitPriceUsed || body.unitPrice || body.pricePerUnit || null,
        quoteUsed || body.quote || null,
        price,
        cost,
        profit,
        commissionValue,
        body.date || new Date().toISOString().slice(0, 10),
        body.status || 'open',
        false,
        body.productType || 'Serviço',
        body.payoutProof || null,
        body.wallet || null,
        body.invoiceUsd || body.invoiceusd || 0
      ]
    );
    res.status(201).json(normalizeOrder(rows[0]));
  } catch (err) {
    console.error('Erro ao criar ordem:', err);

    if (err.message.includes('Cotação USDT indisponível')) {
      return res.status(503).json({
        error: 'Cotação USDT temporariamente indisponível',
        message: 'Por favor, aguarde alguns instantes e tente novamente.'
      });
    }

    res.status(500).json({
      error: 'Falha ao criar ordem',
      detail: err.message
    });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status || 'open', id]);
  if (!rows.length) return res.status(404).json({ error: 'Ordem não encontrada' });
  res.json(normalizeOrder(rows[0]));
});

app.patch('/api/orders/:id/commission', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('UPDATE orders SET commissionPaid=$1 WHERE id=$2 RETURNING *', [Boolean(req.body.commissionPaid), id]);
  if (!rows.length) return res.status(404).json({ error: 'Ordem não encontrada' });
  res.json(normalizeOrder(rows[0]));
});

app.patch('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  try {
    const [existing] = await query('SELECT * FROM orders WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Ordem não encontrada' });

    const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
    const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

    const merged = { ...existing, ...body, id };
    const { price, cost, profit, commissionValue, quoteUsed, unitPriceUsed } = await computeFinancials(merged, seller || existing, service || existing);

    const rows = await query(
      `UPDATE orders SET customer=$1, sellerId=$2, serviceId=$3, quantity=$4, unitPrice=$5, quote=$6, price=$7, cost=$8, profit=$9, commissionValue=$10, date=$11, status=$12, commissionPaid=$13, productType=$14, payoutProof=$15, wallet=$16, invoiceUsd=$17
       WHERE id=$18 RETURNING *`,
      [
        merged.customer,
        merged.sellerid || merged.sellerId || null,
        merged.serviceid || merged.serviceId || null,
        merged.quantity || merged.quantity || 0,
        unitPriceUsed || merged.unitPrice || merged.pricePerUnit || merged.unitprice || null,
        quoteUsed || merged.quote || merged.quote || existing.quote || null,
        price,
        cost,
        profit,
        commissionValue,
        merged.date || new Date().toISOString().slice(0, 10),
        merged.status || 'open',
        merged.commissionpaid ?? merged.commissionPaid ?? false,
        merged.producttype || merged.productType || 'Serviço',
        merged.payoutProof || merged.payoutproof || existing.payoutproof || existing.payoutProof || null,
        merged.wallet || existing.wallet || null,
        merged.invoiceUsd ?? merged.invoiceusd ?? existing.invoiceusd ?? existing.invoiceUsd ?? 0,
        id
      ]
    );
    res.json(normalizeOrder(rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar ordem:', err);
    res.status(500).json({ error: 'Falha ao atualizar ordem', detail: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM orders WHERE id=$1', [id]);
  res.status(204).end();
});

// Atualiza credenciais (email/senha) vinculadas a um usuário
app.patch('/api/users/:id/credentials', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const [user] = await query('SELECT * FROM users WHERE id=$1', [id]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const login = (body.email || user.email || user.name || '').trim();
  if (!login) return res.status(400).json({ error: 'Email é obrigatório para atualizar credenciais' });

  const roleLower = (body.role || user.role || '').toLowerCase();
  const authRole = roleLower.includes('admin') ? 'admin' : 'gerente';
  const authTarget = authRole === 'gerente' ? '/zenith-gerente-completo.html' : '/zenith-admin-completo.html';

  let passwordHash = null;
  if (body.password) {
    passwordHash = bcrypt.hashSync(body.password, 10);
  } else {
    const existing = await query('SELECT password_hash FROM auth_accounts WHERE lower(login)=lower($1) OR lower(email)=lower($1) LIMIT 1', [login]);
    passwordHash = existing[0]?.password_hash || undefined;
  }

  await query(
    `INSERT INTO auth_accounts (login, email, password_hash, role, target)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (login) DO UPDATE
       SET email = EXCLUDED.email,
           password_hash = COALESCE(EXCLUDED.password_hash, auth_accounts.password_hash),
           role = EXCLUDED.role,
           target = EXCLUDED.target`,
    [login, body.email || user.email, passwordHash, authRole, authTarget]
  );

  res.json({ status: 'ok' });
});

// Remove dados de exemplo legacy (clientes/serviços/usuários mock)
async function purgeSampleData() {
  const sampleCustomers = ['Ana Costa', 'Pedro Santos'];
  const sampleServices = ['Consignado INSS', 'Refinanciamento', 'Consignado FGTS'];
  const sampleUsers = ['João Silva', 'Maria Santos'];

  try {
    await query('DELETE FROM assignments WHERE serviceId IN (SELECT id FROM services WHERE name = ANY($1))', [sampleServices]);
    await query('DELETE FROM orders WHERE customer = ANY($1)', [sampleCustomers]);
    await query('DELETE FROM services WHERE name = ANY($1)', [sampleServices]);
    await query('DELETE FROM users WHERE name = ANY($1)', [sampleUsers]);
  } catch (err) {
    console.warn('Falha ao limpar dados de exemplo:', err.message);
  }
}

// Login simples (email ou login + senha)
app.post('/api/login', async (req, res) => {
  const body = req.body || {};
  const login = body.login?.trim();
  const password = body.password;
  if (!login || !password) {
    return res.status(400).json({ error: 'login e password são obrigatórios' });
  }

  const rows = await query(
    'SELECT * FROM auth_accounts WHERE lower(login)=lower($1) OR lower(email)=lower($1) LIMIT 1',
    [login]
  );
  const account = rows[0];
  if (!account || !bcrypt.compareSync(password, account.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  res.json({
    status: 'ok',
    role: account.role,
    target: account.target
  });
});

initDb()
  .then(() => {
    runMigrations().catch(err => console.warn('Migration warning:', err.message));
    purgeSampleData();
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar banco:', err);
    process.exit(1);
  });
