const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const defaultData = {
  users: [
    {
      id: 1,
      name: 'João Silva',
      email: 'joao@zenith.com',
      phone: '(11) 99999-9999',
      role: 'Gerente de Contas',
      commission: 15,
      status: 'Ativo'
    },
    {
      id: 2,
      name: 'Maria Santos',
      email: 'maria@zenith.com',
      phone: '(21) 98888-7777',
      role: 'Consultora Comercial',
      commission: 12,
      status: 'Ativo'
    }
  ],
  services: [
    {
      id: 1,
      name: 'Consignado INSS',
      costType: 'fixo_percentual',
      costFixo: 20,
      costPercentual: 0.8,
      price: 1200,
      status: 'Ativo',
      description: 'Crédito consignado para INSS'
    },
    {
      id: 2,
      name: 'Refinanciamento',
      costType: 'fixo',
      costFixo: 50,
      costPercentual: 0,
      price: 2000,
      status: 'Ativo',
      description: 'Refinanciamento de dívidas'
    },
    {
      id: 3,
      name: 'Consignado FGTS',
      costType: 'percentual',
      costFixo: 0,
      costPercentual: 1.5,
      price: 1500,
      status: 'Ativo',
      description: 'Empréstimo com garantia FGTS'
    }
  ],
  orders: [
    {
      id: 1,
      customer: 'Ana Costa',
      sellerId: 1,
      serviceId: 3,
      price: 1100,
      cost: 450,
      profit: 650,
      commissionValue: 97.5,
      date: '2025-12-23',
      status: 'open',
      commissionPaid: false,
      productType: 'Consignado FGTS'
    },
    {
      id: 2,
      customer: 'Pedro Santos',
      sellerId: 1,
      serviceId: 2,
      price: 2000,
      cost: 800,
      profit: 1200,
      commissionValue: 180,
      date: '2025-12-24',
      status: 'concluded',
      commissionPaid: true,
      productType: 'Refinanciamento'
    }
  ]
};

async function ensureData() {
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    await fs.writeFile(DATA_FILE, JSON.stringify(defaultData, null, 2));
  }
}

async function loadData() {
  await ensureData();
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function saveData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

function calcCost(price, service) {
  if (!service) return 0;
  const { costType, costFixo = 0, costPercentual = 0 } = service;
  if (costType === 'fixo') {
    return Number(costFixo) || 0;
  }
  if (costType === 'percentual') {
    return price * ((Number(costPercentual) || 0) / 100);
  }
  if (costType === 'fixo_percentual') {
    return (Number(costFixo) || 0) + price * ((Number(costPercentual) || 0) / 100);
  }
  return 0;
}

function computeFinancials(order, users, services) {
  const service = services.find(s => s.id === Number(order.serviceId));
  const seller = users.find(u => u.id === Number(order.sellerId));
  const price = Number(order.price) || 0;
  const cost = order.cost != null ? Number(order.cost) : calcCost(price, service);
  const profit = price - cost;
  const commissionRate = seller ? Number(seller.commission || 0) : 0;
  const commissionValue = profit * (commissionRate / 100);

  return {
    price,
    cost,
    profit,
    commissionValue
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

app.get('/api/users', async (_req, res) => {
  const data = await loadData();
  res.json(data.users);
});

app.post('/api/users', async (req, res) => {
  const data = await loadData();
  const body = req.body || {};
  const newUser = {
    id: nextId(data.users),
    name: body.name,
    email: body.email,
    phone: body.phone,
    role: body.role,
    commission: Number(body.commission) || 0,
    status: body.status || 'Ativo'
  };
  data.users.push(newUser);
  await saveData(data);
  res.status(201).json(newUser);
});

app.put('/api/users/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  const idx = data.users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
  data.users[idx] = { ...data.users[idx], ...req.body, id };
  await saveData(data);
  res.json(data.users[idx]);
});

app.delete('/api/users/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  data.users = data.users.filter(u => u.id !== id);
  await saveData(data);
  res.status(204).end();
});

app.get('/api/services', async (_req, res) => {
  const data = await loadData();
  res.json(data.services);
});

app.post('/api/services', async (req, res) => {
  const data = await loadData();
  const body = req.body || {};
  const newService = {
    id: nextId(data.services),
    name: body.name,
    costType: body.costType || 'fixo',
    costFixo: Number(body.costFixo) || 0,
    costPercentual: Number(body.costPercentual) || 0,
    price: Number(body.price) || 0,
    status: body.status || 'Ativo',
    description: body.description || ''
  };
  data.services.push(newService);
  await saveData(data);
  res.status(201).json(newService);
});

app.put('/api/services/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  const idx = data.services.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Serviço não encontrado' });
  data.services[idx] = { ...data.services[idx], ...req.body, id };
  await saveData(data);
  res.json(data.services[idx]);
});

app.delete('/api/services/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  data.services = data.services.filter(s => s.id !== id);
  await saveData(data);
  res.status(204).end();
});

app.get('/api/orders', async (_req, res) => {
  const data = await loadData();
  res.json(data.orders);
});

app.post('/api/orders', async (req, res) => {
  const data = await loadData();
  const body = req.body || {};
  const baseOrder = {
    id: nextId(data.orders),
    customer: body.customer,
    sellerId: body.sellerId ? Number(body.sellerId) : null,
    serviceId: body.serviceId ? Number(body.serviceId) : null,
    status: body.status || 'open',
    commissionPaid: false,
    productType: body.productType || 'Serviço',
    date: body.date || new Date().toISOString().slice(0, 10)
  };

  const { price, cost, profit, commissionValue } = computeFinancials(
    { ...baseOrder, price: body.price, cost: body.cost },
    data.users,
    data.services
  );

  const newOrder = { ...baseOrder, price, cost, profit, commissionValue };
  data.orders.push(newOrder);
  await saveData(data);
  res.status(201).json(newOrder);
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  const order = data.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
  order.status = req.body.status || order.status;
  await saveData(data);
  res.json(order);
});

app.patch('/api/orders/:id/commission', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  const order = data.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
  order.commissionPaid = Boolean(req.body.commissionPaid);
  await saveData(data);
  res.json(order);
});

app.patch('/api/orders/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  const idx = data.orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Ordem não encontrada' });

  const existing = data.orders[idx];
  const updated = { ...existing, ...req.body, id };
  const { price, cost, profit, commissionValue } = computeFinancials(updated, data.users, data.services);
  data.orders[idx] = { ...updated, price, cost, profit, commissionValue };

  await saveData(data);
  res.json(data.orders[idx]);
});

app.delete('/api/orders/:id', async (req, res) => {
  const data = await loadData();
  const id = Number(req.params.id);
  data.orders = data.orders.filter(o => o.id !== id);
  await saveData(data);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
