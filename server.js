process.env.TZ = 'America/Sao_Paulo';

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const connectionString = process.env.DATABASE_URL;
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_MS = Number(process.env.AUTH_TTL_MS || 1000 * 60 * 60 * 24 * 7); // 7 dias
const IS_PROD = process.env.NODE_ENV === 'production';

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL não definido. Configure no Railway para persistir dados.');
}
if (AUTH_SECRET === 'dev-secret-change-me') {
  console.warn('⚠️ AUTH_SECRET não definido. Tokens de login estão usando valor padrão.');
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
      ADD COLUMN IF NOT EXISTS invoiceUsd NUMERIC(14,4) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS historicalQuote NUMERIC(14,6),
      ADD COLUMN IF NOT EXISTS isRetroactive BOOLEAN DEFAULT false;
  `);

  await query(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL';
  `);

  // Campos para registro de trava (hedge)
  await query(`
    ALTER TABLE orders 
    ADD COLUMN IF NOT EXISTS hedgeQtyUsdt NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS hedgePriceBrl NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS hedgeTotalBrl NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS hedgeAt TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hedgeNotes TEXT,
    ADD COLUMN IF NOT EXISTS hedgeCompleted BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS sentAt TIMESTAMPTZ;
  `);
}

function parseCookies(header = '') {
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
}

function signAuthToken(payload = {}) {
  const data = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAuthToken(token) {
  try {
    if (!token) return null;
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (err) {
    console.warn('Token inválido:', err.message);
    return null;
  }
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.auth_token || null;
}

function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: TOKEN_TTL_MS
  });
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const PUBLIC_API_PATHS = ['/login', '/health', '/logout'];
function authMiddleware(req, res, next) {
  if (PUBLIC_API_PATHS.includes(req.path)) return next();
  const token = getTokenFromRequest(req);
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  req.user = payload;
  next();
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

// Autenticação protegendo todas as rotas /api (exceto login/health)
app.use('/api', authMiddleware);

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

function getInvoiceFeeUsd(remessaUsd) {
  const v = Number(remessaUsd) || 0;
  if (v <= 0) return 0;
  if (v <= 5000) return 80;
  if (v <= 10000) return 40;
  return 0;
}

async function computeFinancials(order, seller, service) {
  const rawQty = Number(order.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 0;

  const priceFromPayload = Number(order.price) || 0; // pode ser total informado
  const servicePrice = service ? Number(service.price ?? 0) : 0;
  const invoiceUsdOriginal = Number(order.invoiceUsd ?? order.invoiceusd ?? 0);
  const historicalQuote = Number(order.historicalQuote ?? order.historicalquote ?? 0) || null;
  const invoiceFeeUsd = getInvoiceFeeUsd(quantity);
  const invoiceCostUsd = invoiceFeeUsd > 0 ? 25 : 0;
  const invoiceProfitUsd = invoiceFeeUsd > 0 ? (invoiceFeeUsd - invoiceCostUsd) : 0;

  // Preço unitário informado (preço fechado por USDT)
  const unitPriceRaw = Number(order.unitPrice ?? order.pricePerUnit ?? order.unitprice);
  let unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
    ? unitPriceRaw
    : (Number.isFinite(servicePrice) && servicePrice > 0 ? servicePrice : 0);

  if (!unitPrice && priceFromPayload > 0 && quantity > 0) {
    unitPrice = priceFromPayload / quantity; // deriva unitário apenas se não veio
  }

  // Regra específica apenas para o serviço "Remessa": custo = (cotação + 0,30%) * qtd + 25 USD
  const serviceName = (service?.name || order.productType || '').toString().trim().toLowerCase();
  const isUsdtService = serviceName.includes('usdt');
  const isRemessa = serviceName === 'remessa';
  if (isRemessa) {
    console.log('🔍 ===== COMPUTANDO REMESSA =====');
    console.log('🔹 isRetroactive:', order.isRetroactive ?? false);
    console.log('🔹 remessaUSD:', quantity);
    console.log('🔹 invoiceFeeUsd (fee cobrada auto):', invoiceFeeUsd);
    console.log('🔹 invoiceUsd recebido:', invoiceUsdOriginal);
    if (invoiceUsdOriginal !== invoiceFeeUsd) {
      console.warn(`Invoice corrigida automaticamente: remessa=${quantity} | recebido=${invoiceUsdOriginal} | aplicado=${invoiceFeeUsd}`);
    }
    console.log('🔹 unitPrice (cotação negociada/repasse):', order.unitPrice ?? unitPrice);
    console.log('🔹 historicalQuote (cotação fechamento):', historicalQuote);

    let cotacaoFechamento;
    if (historicalQuote != null && historicalQuote > 0) {
      cotacaoFechamento = Number(historicalQuote);
      console.log('📅 RETROATIVA - Cotação histórica (fechamento):', cotacaoFechamento.toFixed(4));
    } else {
      try {
        cotacaoFechamento = await fetchUsdtQuote();
        console.log('🔄 ATUAL - Cotação Binance (tempo real):', cotacaoFechamento.toFixed(4));
      } catch (err) {
        console.error('⚠️ Impossível criar ordem sem cotação USDT:', err.message);
        throw new Error('Cotação USDT indisponível. Aguarde e tente novamente.');
      }
    }

    const cotacaoNegociada = Number(order.unitPrice ?? unitPrice) || 0; // preço que o cliente paga por USD
    const spreadPercent = Number(service?.costPercentual ?? service?.costpercentual ?? 1.2);
    const costRate = cotacaoFechamento * (1 + spreadPercent / 100); // cotação com spread (custo real)

    // Custo: remessa + (25 USD se tiver invoice) multiplicados pela cotação de custo
    const costBaseUsd = quantity + invoiceCostUsd;
    const cost = costBaseUsd * costRate;

    // Venda: remessa + fee cobrada (80/40/0) multiplicados pela cotação negociada
    const saleBaseUsd = invoiceFeeUsd > 0 ? (quantity + invoiceFeeUsd) : quantity;
    const price = saleBaseUsd * cotacaoNegociada;

    const profit = price - cost;
    const commissionRate = seller ? Number(seller.commission || 0) : 0;
    const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

    console.log('┌─────────────────────────────────┐');
    console.log('│   REMESSA - CÁLCULO DETALHADO   │');
    console.log('├─────────────────────────────────┤');
    console.log('│ ENTRADAS:                       │');
    console.log(`│   Remessa USD.....: ${quantity.toFixed(2)}`);
    console.log(`│   Invoice fee USD.: ${invoiceFeeUsd.toFixed(2)}`);
    console.log(`│   Invoice cost USD: ${invoiceCostUsd.toFixed(2)}`);
    console.log(`│   Invoice profit USD: ${invoiceProfitUsd.toFixed(2)}`);
    console.log('├─────────────────────────────────┤');
    console.log('│ COTAÇÕES:                       │');
    console.log(`│   Cot. base (Binance/Hist)..: R$ ${cotacaoFechamento.toFixed(4)}`);
    console.log(`│   Spread %..................: ${spreadPercent.toFixed(2)}%`);
    console.log(`│   Cot. custo (c/ spread)....: R$ ${costRate.toFixed(4)}`);
    console.log(`│   Cot. repasse (cliente)....: R$ ${cotacaoNegociada.toFixed(4)}`);
    console.log('├─────────────────────────────────┤');
    console.log('│ VALORES (BRL):                 │');
    console.log(`│   Custo total.....: R$ ${cost.toFixed(2)}`);
    console.log(`│   Venda total.....: R$ ${price.toFixed(2)}`);
    console.log(`│   Lucro...........: R$ ${profit.toFixed(2)}`);
    console.log(`│   Comissão........: R$ ${commissionValue.toFixed(2)}`);
    console.log('└─────────────────────────────────┘');

    return {
      price,
      cost,
      profit,
      commissionValue,
      invoiceUsd: invoiceFeeUsd,
      invoiceFeeUsd,
      quoteUsed: cotacaoFechamento,
      unitPriceUsed: cotacaoNegociada || cotacaoFechamento
    };
  }

  if (isUsdtService) {
    console.log('🔍 ===== COMPUTANDO USDT =====');
    let cotacaoFechamento;
    if (historicalQuote != null && historicalQuote > 0) {
      cotacaoFechamento = Number(historicalQuote);
      console.log('📅 USDT - Cotação histórica (fechamento):', cotacaoFechamento.toFixed(4));
    } else {
      try {
        cotacaoFechamento = await fetchUsdtQuote();
        console.log('🔄 USDT - Cotação atual (Binance):', cotacaoFechamento.toFixed(4));
      } catch (err) {
        const fallbackQuote = Number(order.quote ?? unitPrice ?? (priceFromPayload > 0 && quantity > 0 ? priceFromPayload / quantity : 0));
        if (Number.isFinite(fallbackQuote) && fallbackQuote > 0) {
          cotacaoFechamento = fallbackQuote;
          console.warn('⚠️ USDT - usando cotação de fallback:', fallbackQuote.toFixed(4));
        } else {
          console.error('⚠️ Impossível calcular ordem USDT sem cotação:', err.message);
          throw new Error('Cotação USDT indisponível. Aguarde e tente novamente.');
        }
      }
    }

    const spreadPercent = Number(service?.costPercentual ?? service?.costpercentual ?? 0.3);
    const costRate = cotacaoFechamento * (1 + spreadPercent / 100);

    const price = quantity > 0 && unitPrice > 0
      ? unitPrice * quantity
      : priceFromPayload;
    const cost = quantity > 0 ? costRate * quantity : 0;
    const profit = price - cost;
    const commissionRate = seller ? Number(seller.commission || 0) : 0;
    const commissionValue = profit > 0 ? profit * (commissionRate / 100) : 0;

    console.log('=== USDT ORDEM ===');
    console.log('quantity:', quantity);
    console.log('cotacao:', cotacaoFechamento);
    console.log('spread:', spreadPercent);
    console.log('costRate:', costRate);
    console.log('unitPrice:', unitPrice);
    console.log('price:', price);
    console.log('cost:', cost);
    console.log('profit:', profit);

    return {
      price,
      cost,
      profit,
      commissionValue,
      quoteUsed: cotacaoFechamento,
      unitPriceUsed: unitPrice || cotacaoFechamento
    };
  }

  const serviceCostType = service?.costType ?? service?.costtype;
  let quote = null;
  if (historicalQuote != null && historicalQuote > 0) {
    quote = historicalQuote;
    console.log('📅 Usando cotação histórica (retroativa):', quote.toFixed(4));
  } else if (serviceCostType === 'cotacao_percentual') {
    quote = await fetchUsdtQuote();
    console.log('🔄 Usando cotação atual (Binance):', quote.toFixed(4));
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
    historicalQuote: row.historicalquote != null ? Number(row.historicalquote) : null,
    isRetroactive: row.isretroactive ?? row.isRetroactive ?? false,
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    profit: Number(row.profit ?? 0),
    commissionValue: Number(row.commissionValue ?? row.commissionvalue ?? 0),
    date: row.date,
    status: row.status,
    commissionPaid: row.commissionPaid ?? row.commissionpaid,
    productType: row.productType ?? row.producttype,
    payoutProof: row.payoutProof ?? row.payoutproof,
    wallet: row.wallet,
    hedgeQtyUsdt: row.hedgeqtyusdt != null ? Number(row.hedgeqtyusdt) : (row.hedgeQtyUsdt != null ? Number(row.hedgeQtyUsdt) : null),
    hedgePriceBrl: row.hedgepricebrl != null ? Number(row.hedgepricebrl) : (row.hedgePriceBrl != null ? Number(row.hedgePriceBrl) : null),
    hedgeTotalBrl: row.hedgetotalbrl != null ? Number(row.hedgetotalbrl) : (row.hedgeTotalBrl != null ? Number(row.hedgeTotalBrl) : null),
    hedgeAt: row.hedgeat ?? row.hedgeAt ?? null,
    hedgeNotes: row.hedgenotes ?? row.hedgeNotes ?? null,
    hedgeCompleted: Boolean(row.hedgecompleted ?? row.hedgeCompleted ?? false),
    sentAt: row.sentat ?? row.sentAt ?? null
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
      historicalQuote NUMERIC(14,6),
      isRetroactive BOOLEAN DEFAULT false,
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
    try {
      const calc = await computeFinancials({ ...order, price: order.price }, seller, service);
      return { ...order, ...calc, quote: calc.quoteUsed, unitPrice: calc.unitPriceUsed };
    } catch (err) {
      console.warn(`⚠️ Falha ao recalcular ordem #${order.id}:`, err.message);
      // mantém dados persistidos para não quebrar a listagem
      return {
        ...order,
        quote: order.quote ?? order.historicalQuote ?? null,
        unitPrice: order.unitPrice ?? order.unitprice ?? null
      };
    }
  }));

  res.json(enriched);
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const [seller] = body.sellerId ? await query('SELECT * FROM users WHERE id=$1', [body.sellerId]) : [null];
    const [service] = body.serviceId ? await query('SELECT * FROM services WHERE id=$1', [body.serviceId]) : [null];

    const { price, cost, profit, commissionValue, quoteUsed, unitPriceUsed, invoiceUsd: invoiceFeeUsd } = await computeFinancials(body, seller, service);

    // Calcular automaticamente se é retroativa
    const orderDate = new Date(body.date || new Date().toISOString().slice(0, 10));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    orderDate.setHours(0, 0, 0, 0);
    const isRetroactiveCalculated = orderDate < today;

    const rows = await query(
      `INSERT INTO orders (customer, sellerId, serviceId, quantity, unitPrice, quote, price, cost, profit, commissionValue, date, status, commissionPaid, productType, payoutProof, wallet, invoiceUsd, historicalQuote, isRetroactive)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
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
        body.date || getLocalDateString(),
        body.status || 'open',
        false,
        body.productType || 'Serviço',
        body.payoutProof || null,
        body.wallet || null,
        invoiceFeeUsd ?? body.invoiceUsd ?? body.invoiceusd ?? 0,
        body.historicalQuote || body.historicalquote || null,
        isRetroactiveCalculated
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
    // Recalcular isRetroactive se a data foi alterada
    if (merged.date) {
      const orderDate = new Date(merged.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      orderDate.setHours(0, 0, 0, 0);
      merged.isRetroactive = orderDate < today;
    }
    const { price, cost, profit, commissionValue, quoteUsed, unitPriceUsed, invoiceUsd: invoiceFeeUsd } = await computeFinancials(merged, seller || existing, service || existing);

    const rows = await query(
      `UPDATE orders SET customer=$1, sellerId=$2, serviceId=$3, quantity=$4, unitPrice=$5, quote=$6, price=$7, cost=$8, profit=$9, commissionValue=$10, date=$11, status=$12, commissionPaid=$13, productType=$14, payoutProof=$15, wallet=$16, invoiceUsd=$17, historicalQuote=$18, isRetroactive=$19
       WHERE id=$20 RETURNING *`,
      [
        merged.customer,
        merged.sellerid || merged.sellerId || null,
        merged.serviceid || merged.serviceId || null,
        merged.quantity ?? 0,
        unitPriceUsed || merged.unitPrice || merged.pricePerUnit || merged.unitprice || null,
        quoteUsed ?? merged.quote ?? existing.quote ?? null,
        price,
        cost,
        profit,
        commissionValue,
        merged.date || getLocalDateString(),
        merged.status || 'open',
        merged.commissionpaid ?? merged.commissionPaid ?? false,
        merged.producttype || merged.productType || 'Serviço',
        merged.payoutProof || merged.payoutproof || existing.payoutproof || existing.payoutProof || null,
        merged.wallet || existing.wallet || null,
        invoiceFeeUsd ?? merged.invoiceUsd ?? merged.invoiceusd ?? existing.invoiceusd ?? existing.invoiceUsd ?? 0,
        merged.historicalQuote ?? merged.historicalquote ?? existing.historicalquote ?? null,
        merged.isRetroactive ?? merged.isretroactive ?? existing.isretroactive ?? false,
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

// Registrar trava (hedge) executada
app.patch('/api/orders/:id/hedge', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  
  try {
    const [existing] = await query('SELECT * FROM orders WHERE id=$1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }
    
    const hedgeTotalBrl = Number(body.hedgeTotalBrl);
    if (!Number.isFinite(hedgeTotalBrl) || hedgeTotalBrl <= 0) {
      return res.status(400).json({ 
        error: 'hedgeTotalBrl é obrigatório e deve ser maior que zero' 
      });
    }
    
    const hedgeQtyUsdt = body.hedgeQtyUsdt ? Number(body.hedgeQtyUsdt) : null;
    const hedgePriceBrl = body.hedgePriceBrl ? Number(body.hedgePriceBrl) : null;
    const hedgeNotes = body.hedgeNotes || null;
    const hedgeAt = body.hedgeAt ? new Date(body.hedgeAt) : new Date();
    
    if (hedgeQtyUsdt && hedgePriceBrl) {
      const calculado = hedgeQtyUsdt * hedgePriceBrl;
      const diff = Math.abs(calculado - hedgeTotalBrl);
      const diffPct = (diff / hedgeTotalBrl) * 100;
      
      if (diffPct > 1 && diff > 50) {
        return res.status(400).json({
          error: 'TRAVA_TOTAL_DIVERGE_DE_QTY_PRICE',
          message: 'O total informado diverge do cálculo (quantidade × preço)',
          calculado: calculado.toFixed(2),
          informado: hedgeTotalBrl.toFixed(2),
          diferenca: diff.toFixed(2),
          diferencaPct: diffPct.toFixed(2) + '%'
        });
      }
    }
    
    const rows = await query(`
      UPDATE orders SET
        hedgeTotalBrl = $1,
        hedgeQtyUsdt = $2,
        hedgePriceBrl = $3,
        hedgeAt = $4,
        hedgeNotes = $5,
        hedgeCompleted = true
      WHERE id = $6
      RETURNING *
    `, [hedgeTotalBrl, hedgeQtyUsdt, hedgePriceBrl, hedgeAt, hedgeNotes, id]);
    
    res.json(normalizeOrder(rows[0]));
    
  } catch (err) {
    console.error('Erro ao salvar trava:', err);
    res.status(500).json({ 
      error: 'Falha ao salvar trava', 
      detail: err.message 
    });
  }
});

// Marcar ordem como enviada (valida comprovante + trava)
app.post('/api/orders/:id/send', async (req, res) => {
  const id = Number(req.params.id);
  
  try {
    const [order] = await query('SELECT * FROM orders WHERE id=$1', [id]);
    
    if (!order) {
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }
    
    if (!order.payoutproof && !order.payoutProof) {
      return res.status(409).json({ 
        error: 'Comprovante de pagamento não anexado',
        field: 'payoutProof'
      });
    }
    
    const hedgeCompleted = Boolean(order.hedgecompleted ?? order.hedgeCompleted);
    const hedgeTotalBrl = Number(order.hedgetotalbrl ?? order.hedgeTotalBrl ?? 0);
    
    if (!hedgeCompleted || hedgeTotalBrl <= 0) {
      return res.status(409).json({ 
        error: 'Trava não foi registrada',
        field: 'hedgeCompleted'
      });
    }
    
    const rows = await query(
      'UPDATE orders SET sentAt=$1 WHERE id=$2 RETURNING *',
      [new Date(), id]
    );
    
    res.json({
      status: 'ok',
      message: 'Ordem marcada como enviada',
      order: normalizeOrder(rows[0])
    });
    
  } catch (err) {
    console.error('Erro ao enviar ordem:', err);
    res.status(500).json({ 
      error: 'Falha ao enviar ordem', 
      detail: err.message 
    });
  }
});

function filterOrdersByPeriodServer(orders, period, selectedDate) {
  const normalized = (period || 'all').toLowerCase();
  if (normalized === 'all') return [...orders];

  const getOrderDateValue = (order = {}) =>
    order.date ?? order.created_at ?? order.createdAt ?? order.sentAt ?? order.sentat ?? null;

  const getDateOnly = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      return value.slice(0, 10);
    }
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (normalized === 'date' && selectedDate) {
    const targetStr = getDateOnly(selectedDate);
    if (!targetStr) return [...orders];
    return orders.filter(order => {
      const orderDateStr = getDateOnly(getOrderDateValue(order));
      return orderDateStr === targetStr;
    });
  }

  if (normalized === 'today') {
    return orders.filter(order => getDateOnly(getOrderDateValue(order)) === todayStr);
  }

  if (normalized === 'month') {
    const yearMonth = todayStr.slice(0, 7);
    return orders.filter(order => {
      const orderDateStr = getDateOnly(getOrderDateValue(order));
      return orderDateStr && orderDateStr.startsWith(yearMonth);
    });
  }

  if (normalized === 'week') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const startStr = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, '0')}-${String(startOfWeek.getDate()).padStart(2, '0')}`;
    const endStr = `${endOfWeek.getFullYear()}-${String(endOfWeek.getMonth() + 1).padStart(2, '0')}-${String(endOfWeek.getDate()).padStart(2, '0')}`;

    return orders.filter(order => {
      const orderDateStr = getDateOnly(getOrderDateValue(order));
      return orderDateStr && orderDateStr >= startStr && orderDateStr <= endStr;
    });
  }

  return [...orders];
}

function calculateRemessaDashboardMetrics(orders = []) {
  let somaLucroTx = 0;
  let somaMeuLucroTotal = 0;
  let somaLucroRepasse = 0;
  let somaProfitReal = 0;
  let somaInvoiceFeeUsd = 0;
  let somaInvoiceCostUsd = 0;
  let volumeUsd = 0;
  let totalOperacoesCalculadas = 0;
  let ordensSemBaseQuote = 0;
  let ordensSemTrava = 0;
  let ordensComTrava = 0;

  const getFee = typeof getInvoiceFeeUsd === 'function'
    ? getInvoiceFeeUsd
    : (remessaUsd) => {
        const v = Number(remessaUsd) || 0;
        if (v <= 0) return 0;
        if (v <= 5000) return 80;
        if (v <= 10000) return 40;
        return 0;
      };

  orders.forEach(order => {
    const productType = (order.productType || order.producttype || '').toString().trim().toLowerCase();
    const serviceName = (order.serviceName || '').toString().trim().toLowerCase();
    if (productType !== 'remessa' && serviceName !== 'remessa') {
      return;
    }

    const quantity = Number(order.quantity ?? 0) || 0;
    const R = Number(order.quote ?? order.historicalQuote ?? order.historicalquote) || 0;
    if (!(quantity > 0)) return;
    if (!(R > 0)) {
      ordensSemBaseQuote++;
      return;
    }

    const invoiceFeeUsd = getFee(quantity);
    const invoiceCostUsd = invoiceFeeUsd > 0 ? 25 : 0;
    const costBaseUsd = quantity + invoiceCostUsd;
    const profitReal = Number(order.profit ?? 0) || 0;

    // Lucro TX (trava)
    const hedgeTotalBrl = Number(order.hedgeTotalBrl ?? order.hedgetotalbrl ?? 0) || 0;
    const custoRealBrl = Number(order.cost ?? 0) || 0;
    let lucroTxBrl = 0;
    if (hedgeTotalBrl > 0) {
      // Lucro TX = custo do gerente (order.cost) - custo real informado na trava
      lucroTxBrl = custoRealBrl - hedgeTotalBrl;
      ordensComTrava++;
    } else {
      ordensSemTrava++;
    }

    // Lucro repasse (comissão da ordem)
    const lucroRepasse = Number(order.commissionValue ?? order.commissionvalue ?? 0) || 0;

    const meuLucroTotal = lucroTxBrl + lucroRepasse;

    somaLucroTx += lucroTxBrl;
    somaLucroRepasse += lucroRepasse;
    somaMeuLucroTotal += meuLucroTotal;
    somaProfitReal += profitReal;
    // métricas de auditoria
    somaInvoiceFeeUsd += invoiceFeeUsd;
    somaInvoiceCostUsd += invoiceCostUsd;
    volumeUsd += quantity;
    totalOperacoesCalculadas++;
  });

  return {
    somaLucroTx,
    somaLucroRepasse,
    somaLucroTotal: somaMeuLucroTotal,
    somaProfitReal,
    auditoria: {
      somaInvoiceFeeUsd,
      somaInvoiceCostUsd,
      ordensSemTrava,
      ordensComTrava
    },
    volumeUsd,
    totalOperacoes: orders.length,
    totalOperacoesCalculadas,
    ordensSemBaseQuote,
    ordensSemTrava,
    ordensComTrava,
    temOrdensSemCotacao: ordensSemBaseQuote > 0,
    temOrdensSemTrava: ordensSemTrava > 0,
    temOrdensSemUnitPrice: false,
    ordensComFallbackUnitPrice: 0,
    temFallbackUnitPrice: false
  };
}

app.get('/api/dashboard/remessa', async (req, res) => {
  try {
    const period = (req.query.periodo || req.query.period || 'all').toString().toLowerCase();
    const selectedDate = req.query.date;
    
    // Buscar ordens concluded + serviços + usuários
    const rows = await query(
      'SELECT o.* FROM orders o WHERE o.status = $1',
      ['concluded']
    );
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

    // RECALCULAR todas as ordens (igual /api/orders)
    const enriched = await Promise.all(rows.map(async (row) => {
      const order = normalizeOrder(row);
      let service = servicesMap[order.serviceId];
      if (!service && order.productType) {
        service = servicesByName[order.productType.toLowerCase()];
      }
      const seller = usersMap[order.sellerId];
      
      try {
        const calc = await computeFinancials({ ...order, price: order.price }, seller, service);
        return { 
          ...order, 
          ...calc, 
          quote: calc.quoteUsed, 
          unitPrice: calc.unitPriceUsed,
          serviceName: service?.name
        };
      } catch (err) {
        console.warn(`⚠️ Falha ao recalcular ordem #${order.id}:`, err.message);
        return {
          ...order,
          serviceName: service?.name,
          quote: order.quote ?? order.historicalQuote ?? null,
          unitPrice: order.unitPrice ?? order.unitprice ?? null
        };
      }
    }));

    // Filtrar apenas remessas
    const remessaOrders = enriched.filter(order => {
      const productType = (order.productType || order.producttype || '').toString().trim().toLowerCase();
      const serviceName = (order.serviceName || '').toString().trim().toLowerCase();
      return productType === 'remessa' || serviceName === 'remessa';
    });

    // Aplicar filtro de período
    const filtered = filterOrdersByPeriodServer(remessaOrders, period, selectedDate);
    
    // Calcular métricas
    const metrics = calculateRemessaDashboardMetrics(filtered);

    res.json(metrics);
  } catch (err) {
    console.error('Erro ao calcular dashboard de remessa:', err);
    res.status(500).json({ error: 'Falha ao carregar dashboard de remessa', detail: err.message });
  }
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

  const token = signAuthToken({
    login: account.login,
    email: account.email,
    role: account.role,
    target: account.target
  });
  setAuthCookie(res, token);

  res.json({
    status: 'ok',
    role: account.role,
    target: account.target,
    login: account.login,
    email: account.email,
    token
  });
});

app.post('/api/logout', (req, res) => {
  res.cookie('auth_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 0
  });
  res.status(204).end();
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
