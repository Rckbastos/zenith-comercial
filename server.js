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

app.use(express.json({ limit: '1mb' }));

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
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL');
    const data = await res.json();
    const price = Number(data?.price);
    return Number.isFinite(price) ? price : 0;
  } catch (err) {
    console.error('Erro ao buscar cotação USDT:', err.message);
    return 0;
  }
}

function calcCost(price, service, opts = {}) {
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
  if (costtype === 'cotacao_percentual') {
    const quote = Number(opts.quote) || 0;
    return quote * (1 + ((Number(costpercentual) || 0) / 100));
  }
  return 0;
}

async function computeFinancials(order, seller, service) {
  const price = Number(order.price) || 0;
  let quote = null;
  if (service && service.costType === 'cotacao_percentual') {
    quote = await fetchUsdtQuote();
  }
  const cost = order.cost != null ? Number(order.cost) : calcCost(price, service, { quote });
  const profit = price - cost;
  const commissionRate = seller ? Number(seller.commission || 0) : 0;
  const commissionValue = profit * (commissionRate / 100);

  return { price, cost, profit, commissionValue };
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
    description: row.description
  };
}

function normalizeOrder(row = {}) {
  return {
    id: row.id,
    customer: row.customer,
    sellerId: row.sellerId ?? row.sellerid,
    serviceId: row.serviceId ?? row.serviceid,
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    profit: Number(row.profit ?? 0),
    commissionValue: Number(row.commissionValue ?? row.commissionvalue ?? 0),
    date: row.date,
    status: row.status,
    commissionPaid: row.commissionPaid ?? row.commissionpaid,
    productType: row.productType ?? row.producttype
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
    `INSERT INTO services (name, costType, costFixo, costPercentual, price, status, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.description || '']
  );
  res.status(201).json(normalizeService(rows[0]));
});

app.put('/api/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const rows = await query(
    `UPDATE services SET name=$1, costType=$2, costFixo=$3, costPercentual=$4, price=$5, status=$6, description=$7 WHERE id=$8 RETURNING *`,
    [body.name, body.costType, body.costFixo || 0, body.costPercentual || 0, body.price || 0, body.status || 'Ativo', body.description || '', id]
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
  res.json(rows.map(normalizeOrder));
});

app.post('/api/orders', async (req, res) => {
  const body = req.body || {};
  const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
  const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

  const { price, cost, profit, commissionValue } = await computeFinancials(body, seller, service);

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
  res.status(201).json(normalizeOrder(rows[0]));
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
  const [existing] = await query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!existing) return res.status(404).json({ error: 'Ordem não encontrada' });

  const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
  const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

  const merged = { ...existing, ...body, id };
  const { price, cost, profit, commissionValue } = await computeFinancials(merged, seller || existing, service || existing);

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
  res.json(normalizeOrder(rows[0]));
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
    purgeSampleData();
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar banco:', err);
    process.exit(1);
  });
