require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const path       = require('path');

const Transaction = require('./models/Transaction');
const Click       = require('./models/Click');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend'))); // serve from frontend/

// ── MongoDB connection ────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── ROUTES ────────────────────────────────────────────────

// POST /api/track/click  — log every BUY NOW click
app.post('/api/track/click', async (req, res) => {
  try {
    const { nftName, nftIndex, wallet, action, userAgent } = req.body;
    const click = new Click({ nftName, nftIndex, wallet, action, userAgent });
    await click.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Click track error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/track/transaction  — log confirmed tx
app.post('/api/track/transaction', async (req, res) => {
  try {
    const { nftName, nftIndex, solAmount, usdAmount, signature, wallet, network, type } = req.body;
    // avoid duplicate signatures
    const exists = await Transaction.findOne({ signature });
    if (exists) return res.json({ success: true, duplicate: true });
    const tx = new Transaction({ nftName, nftIndex, solAmount, usdAmount, signature, wallet, network, type });
    await tx.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Transaction track error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /health — check server + MongoDB status
app.get('/health', (req, res) => {
  const mongoState = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    server: 'ok',
    mongodb: mongoState[mongoose.connection.readyState] || 'unknown',
    env: {
      hasMongoUri: !!process.env.MONGODB_URI,
      hasAdminPw: !!process.env.ADMIN_PASSWORD
    }
  });
});

// GET /api/stats  — admin stats (password protected)
app.get('/api/stats', async (req, res) => {
  const pw = req.headers['x-admin-password'];
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    console.log('📊 Stats requested, querying MongoDB...');
    const transactions = await Transaction.find().sort({ timestamp: -1 });
    const clicks       = await Click.find().sort({ timestamp: -1 });
    console.log(`✅ Found ${transactions.length} transactions, ${clicks.length} clicks`);

    // Revenue totals
    const totalSol = transactions.reduce((sum, t) => sum + t.solAmount, 0);
    const totalUsd = transactions.reduce((sum, t) => sum + (t.usdAmount || 0), 0);

    // Per-NFT breakdown
    const nftStats = {};
    transactions.forEach(t => {
      if (!nftStats[t.nftName]) nftStats[t.nftName] = { sales: 0, sol: 0, usd: 0 };
      nftStats[t.nftName].sales++;
      nftStats[t.nftName].sol  += t.solAmount;
      nftStats[t.nftName].usd  += (t.usdAmount || 0);
    });

    // Click breakdown
    const clickStats = {};
    clicks.forEach(c => {
      if (!clickStats[c.nftName]) clickStats[c.nftName] = 0;
      clickStats[c.nftName]++;
    });

    // Wallet connect count
    const walletConnects = clicks.filter(c => c.action === 'wallet_connect').length;
    const buyClicks      = clicks.filter(c => c.action === 'buy_click').length;
    const pageViews      = clicks.filter(c => c.action === 'page_view').length;

    res.json({
      summary: {
        totalTransactions: transactions.length,
        totalSol: parseFloat(totalSol.toFixed(4)),
        totalUsd: parseFloat(totalUsd.toFixed(2)),
        totalClicks: clicks.length,
        buyClicks,
        walletConnects,
        pageViews,
        conversionRate: buyClicks > 0
          ? ((transactions.length / buyClicks) * 100).toFixed(1) + '%'
          : '0%'
      },
      nftStats,
      clickStats,
      recentTransactions: transactions.slice(0, 20),
      recentClicks: clicks.slice(0, 50)
    });
  } catch (err) {
    console.error('❌ Stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /about
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

// GET /admin  — serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

// GET / — serve main site
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 GRNGMRKT server running at http://localhost:${PORT}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
});
