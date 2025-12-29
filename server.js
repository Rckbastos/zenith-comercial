const express = require('express');
const path = require('path');
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

app.use(express.json({ limit: '1mb' }));

// CSP para permitir Google Fonts e Binance API
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
      "script-src 'self'",
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
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/zenith-admin-completo.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'zenith-admin-completo.html'));
});

app.get('/zenith-gerente-completo.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'zenith-gerente-completo.html'));
});

// Fallback para outras rotas (exceto API e assets), retorna index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.includes('.')) return next();
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

function calcCost(price, service) {
  if (!service) return 0;
  const { costtype, costfixo = 0, costpercentual = 0 } = service;
  if (costtype === 'fixo') {
    return Number(costfixo) || 0;
  }
  if (costtype === 'percentual') {
    return price * ((Number(costpercentual) || 0) / 100);
  }
  if (costtype === 'fixo_percentual') {
    return (Number(costfixo) || 0) + price * ((Number(costpercentual) || 0) / 100);
  }
  return 0;
}

function computeFinancials(order, seller, service) {
  const price = Number(order.price) || 0;
  const cost = order.cost != null ? Number(order.cost) : calcCost(price, service);
  const profit = price - cost;
  const commissionRate = seller ? Number(seller.commission || 0) : 0;
  const commissionValue = profit * (commissionRate / 100);

  return { price, cost, profit, commissionValue };
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
      description TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer TEXT,
      sellerId INT REFERENCES users(id),
      serviceId INT REFERENCES services(id),
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

  // Seed inicial se estiver vazio
  const usersCount = (await query('SELECT COUNT(*)::int AS count FROM users'))[0].count;
  if (usersCount === 0) {
    await query(
      `INSERT INTO users (name, email, phone, role, commission, status) VALUES
      ('João Silva','joao@zenith.com','(11) 99999-9999','Gerente de Contas',15,'Ativo'),
      ('Maria Santos','maria@zenith.com','(21) 98888-7777','Consultora Comercial',12,'Ativo')`
    );
  }

  const servicesCount = (await query('SELECT COUNT(*)::int AS count FROM services'))[0].count;
  if (servicesCount === 0) {
    await query(
      `INSERT INTO services (name, costType, costFixo, costPercentual, price, status, description) VALUES
      ('Consignado INSS','fixo_percentual',20,0.8,1200,'Ativo','Crédito consignado para INSS'),
      ('Refinanciamento','fixo',50,0,2000,'Ativo','Refinanciamento de dívidas'),
      ('Consignado FGTS','percentual',0,1.5,1500,'Ativo','Empréstimo com garantia FGTS')`
    );
  }

  const ordersCount = (await query('SELECT COUNT(*)::int AS count FROM orders'))[0].count;
  if (ordersCount === 0) {
    await query(
      `INSERT INTO orders (customer, sellerId, serviceId, price, cost, profit, commissionValue, date, status, commissionPaid, productType)
       VALUES
       ('Ana Costa', 1, 3, 1100, 450, 650, 97.5, '2025-12-23', 'open', false, 'Consignado FGTS'),
       ('Pedro Santos', 1, 2, 2000, 800, 1200, 180, '2025-12-24', 'concluded', true, 'Refinanciamento')`
    );
  }
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
  res.json(rows);
});

app.post('/api/users', async (req, res) => {
  const body = req.body || {};
  const rows = await query(
    `INSERT INTO users (name, email, phone, role, commission, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.name, body.email, body.phone, body.role, body.commission || 0, body.status || 'Ativo']
  );
  res.status(201).json(rows[0]);
});

app.put('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rows = await query(
    `UPDATE users SET name=$1, email=$2, phone=$3, role=$4, commission=$5, status=$6 WHERE id=$7 RETURNING *`,
    [body.name, body.email, body.phone, body.role, body.commission || 0, body.status || 'Ativo', id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(rows[0]);
});

app.delete('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM users WHERE id=$1', [id]);
  res.status(204).end();
});

// Services
app.get('/api/services', async (_req, res) => {
  const rows = await query('SELECT * FROM services ORDER BY id');
  res.json(rows);
});

app.post('/api/services', async (req, res) => {
  const body = req.body || {};
  const rows = await query(
    `INSERT INTO services (name, costType, costFixo, costPercentual, price, status, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.description || '']
  );
  res.status(201).json(rows[0]);
});

app.put('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rows = await query(
    `UPDATE services SET name=$1, costType=$2, costFixo=$3, costPercentual=$4, price=$5, status=$6, description=$7 WHERE id=$8 RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.description || '', id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(rows[0]);
});

app.delete('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM services WHERE id=$1', [id]);
  res.status(204).end();
});

// Orders
app.get('/api/orders', async (_req, res) => {
  const rows = await query('SELECT * FROM orders ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/orders', async (req, res) => {
  const body = req.body || {};
  const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
  const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

  const { price, cost, profit, commissionValue } = computeFinancials(body, seller, service);

  const rows = await query(
    `INSERT INTO orders (customer, sellerId, serviceId, price, cost, profit, commissionValue, date, status, commissionPaid, productType)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      body.customer,
      body.sellerId || null,
      body.serviceId || null,
      price,
      cost,
      profit,
      commissionValue,
      body.date || new Date().toISOString().slice(0, 10),
      body.status || 'open',
      false,
      body.productType || 'Serviço'
    ]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status || 'open', id]);
  if (!rows.length) return res.status(404).json({ error: 'Ordem não encontrada' });
  res.json(rows[0]);
});

app.patch('/api/orders/:id/commission', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query('UPDATE orders SET commissionPaid=$1 WHERE id=$2 RETURNING *', [Boolean(req.body.commissionPaid), id]);
  if (!rows.length) return res.status(404).json({ error: 'Ordem não encontrada' });
  res.json(rows[0]);
});

app.patch('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const [existing] = await query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!existing) return res.status(404).json({ error: 'Ordem não encontrada' });

  const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
  const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

  const merged = { ...existing, ...body, id };
  const { price, cost, profit, commissionValue } = computeFinancials(merged, seller || existing, service || existing);

  const rows = await query(
    `UPDATE orders SET customer=$1, sellerId=$2, serviceId=$3, price=$4, cost=$5, profit=$6, commissionValue=$7, date=$8, status=$9, commissionPaid=$10, productType=$11
     WHERE id=$12 RETURNING *`,
    [
      merged.customer,
      merged.sellerid || merged.sellerId || null,
      merged.serviceid || merged.serviceId || null,
      price,
      cost,
      profit,
      commissionValue,
      merged.date || new Date().toISOString().slice(0, 10),
      merged.status || 'open',
      merged.commissionpaid ?? merged.commissionPaid ?? false,
      merged.producttype || merged.productType || 'Serviço',
      id
    ]
  );
  res.json(rows[0]);
});

app.delete('/api/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM orders WHERE id=$1', [id]);
  res.status(204).end();
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar banco:', err);
    process.exit(1);
  });
