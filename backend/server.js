require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initPool } = require('./config/db');
const authRoutes = require('./routes/auth');
const pocRoutes = require('./routes/poc');
const bpoRoutes = require('./routes/bpo');
const userRoutes = require('./routes/users');
const holidayRoutes = require('./routes/holiday');
const lineSetupRoutes = require('./routes/lineSetup');
const lineCapacityRoutes = require('./routes/lineCapacity');
const lineDailyRoutes = require('./routes/lineDaily');
const sewingOrderRoutes = require('./routes/sewingOrder');
const learningCurveRoutes = require('./routes/learningCurve');
const planningStripRoutes = require('./routes/planningStrip');
const freezePlanRoutes = require('./routes/freezePlan');
const brandColorRoutes = require('./routes/brandColor');
const productionUnitRoutes = require('./routes/productionUnit');
const planningSettingsRoutes = require('./routes/planningSettings');
const processCapacityRoutes = require('./routes/processCapacity');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/poc', pocRoutes);
app.use('/api/bpo', bpoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/holiday', holidayRoutes);
app.use('/api/line-setup', lineSetupRoutes);
app.use('/api/line-capacity', lineCapacityRoutes);
app.use('/api/line-daily', lineDailyRoutes);
app.use('/api/sewing-orders', sewingOrderRoutes);
app.use('/api/learning-curve', learningCurveRoutes);
app.use('/api/strips', planningStripRoutes);
app.use('/api/freeze-plan', freezePlanRoutes);
app.use('/api/brand-color', brandColorRoutes);
app.use('/api/production-units', productionUnitRoutes);
app.use('/api/planning-settings', planningSettingsRoutes);
app.use('/api/process-capacity', processCapacityRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;

initPool()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize DB pool:', err);
    process.exit(1);
  });
