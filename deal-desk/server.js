
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const dealsRoutes = require('./routes/deals');
const approvalsRoutes = require('./routes/approvals');
const invoiceRoutes = require('./routes/invoices');
const authRoutes = require('./routes/auth');
const { authenticateToken } = require('./middleware/guard');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

app.use(cors());

// Capture the original request bytes for webhook signature verification.
app.use(express.json({
    verify: (req, res, buffer) => {
        req.rawBody = Buffer.from(buffer);
    }
}));

// MongoDB connection
const MONGO_URI =
    process.env.MONGO_URI || 'mongodb://localhost:27017/dealdesk';

mongoose.connect(MONGO_URI)
    .then(() => console.log('DealDesk MongoDB connected successfully'))
    .catch(err => console.error('MongoDB connection error:', err));

// Make Socket.IO accessible to routes.
app.set('io', io);

// Initialize chat sockets.
const initSocket = require('./sockets/chatSocket');
initSocket(io);

// API routes
// Public authentication route
app.use('/auth', authRoutes);

// Protected API routes
app.use('/deals', authenticateToken, dealsRoutes);
app.use('/approvals', authenticateToken, approvalsRoutes);

// Webhook endpoint must remain public because BillPort authenticates
// requests using its HMAC signature instead of a user JWT.
app.use('/api/billing', invoiceRoutes);
// Initialize retry and reconciliation jobs.
const { initReconciliationJob } =
    require('./services/invoiceService');

initReconciliationJob(io);

// Basic test route
app.get('/', (req, res) => {
    res.send({
        status: 'DealDesk Backend is running'
    });
});

// Start server
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log(`DealDesk server running on port ${PORT}`);
});
