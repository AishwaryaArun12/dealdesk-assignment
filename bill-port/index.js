
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(cors());

// Preserve raw request body for signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

const PORT = process.env.PORT || 4001;
const SHARED_SECRET =
    process.env.SHARED_SECRET || 'billport-super-secret-key-123';

    const DEALDESK_WEBHOOK_URL =
    process.env.DEALDESK_WEBHOOK_URL ||
    'http://localhost:4000/api/billing/webhook';


// In-memory databases
const invoices = new Map();
const idempotencyStore = new Map();
const processedRequests = new Map();

// Generate HMAC signature
function generateSignature(rawBody) {
    return crypto
        .createHmac('sha256', SHARED_SECRET)
        .update(rawBody)
        .digest('hex');
}

// Verify HMAC signature
function verifySignature(rawBody, signature) {
    if (!signature || !rawBody) return false;

    const expectedSignature = Buffer.from(
        generateSignature(rawBody),
        'hex'
    );

    let receivedSignature;

    try {
        receivedSignature = Buffer.from(signature, 'hex');
    } catch (error) {
        return false;
    }

    if (receivedSignature.length !== expectedSignature.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        expectedSignature,
        receivedSignature
    );
}

// Schedule the next invoice status update
function scheduleProgress(externalId) {
    const delay = Math.floor(Math.random() * 26000) + 5000;

    setTimeout(() => {
        const invoice = invoices.get(externalId);

        if (!invoice) return;

        if (
            invoice.status === 'PAID' ||
            invoice.status === 'FAILED'
        ) {
            return;
        }

        let nextStatus;
        let nextSequence;

        switch (invoice.status) {
            case 'QUEUED':
                nextStatus = 'SENT';
                nextSequence = 1;
                break;

            case 'SENT':
                nextStatus = 'VIEWED';
                nextSequence = 2;
                break;

            case 'VIEWED':
                nextStatus = Math.random() > 0.2
                    ? 'PAID'
                    : 'FAILED';
                nextSequence = 3;
                break;

            default:
                return;
        }

        invoice.status = nextStatus;
        invoice.sequence = nextSequence;
        invoice.updatedAt = new Date();

        console.log(
            `Invoice ${externalId} status updated to ${nextStatus}`
        );

        sendWebhook(invoice);

        // Continue until invoice reaches a final status
        if (
            nextStatus !== 'PAID' &&
            nextStatus !== 'FAILED'
        ) {
            scheduleProgress(externalId);
        }

    }, delay);
}

// Send webhook to DealDesk

// Webhook testing controls
let webhookBlocked = false;
const webhookRetryTimers = new Set();

// Send webhook to DealDesk with retry support.
async function sendWebhook(invoice, options = {}) {
    const webhookPayload = {
        eventId: options.eventId || crypto.randomUUID(),
        externalId: invoice.externalId,
        status: invoice.status,
        sequence: invoice.sequence,
        occurredAt: new Date().toISOString()
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = generateSignature(rawBody);

    if (webhookBlocked) {
        console.log('Webhook delivery blocked:', invoice.externalId);
        return false;
    }

    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (webhookBlocked) {
            console.log('Webhook blocked during retry.');
            return false;
        }

        try {
            const response = await fetch(DEALDESK_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Signature': signature
                },
                body: rawBody
            });

            if (response.ok) {
                console.log(
                    `Webhook delivered: ${invoice.externalId} | ${invoice.status}`
                );
                return true;
            }

            console.log(
                `Webhook attempt ${attempt} failed: HTTP ${response.status}`
            );

        } catch (error) {
            console.error(
                `Webhook attempt ${attempt} error:`,
                error.message
            );
        }

        if (attempt < maxAttempts) {
            const delay = Math.min(1000 * (2 ** (attempt - 1)), 16000);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    console.error(
        `Webhook delivery exhausted for ${invoice.externalId}`
    );

    return false;
}


// 1. POST /billing/invoices
app.post('/billing/invoices', async (req, res) => {
    try {
        const idempotencyKey =
            req.headers['idempotency-key'];

        const signature = req.headers['x-signature'];

        // Verify incoming request signature
        if (!verifySignature(req.rawBody, signature)) {
            return res.status(401).json({
                error: 'Invalid request signature'
            });
        }

        // Idempotency key is required
        if (!idempotencyKey) {
            return res.status(400).json({
                error: 'Idempotency-Key header is required'
            });
        }

        // Return existing invoice for duplicate requests
        if (idempotencyStore.has(idempotencyKey)) {
            const existingId =
                idempotencyStore.get(idempotencyKey);

            const existingInvoice = invoices.get(existingId);

            console.log(
                `Duplicate request detected: ${idempotencyKey}`
            );

            return res.status(201).json({
                externalId: existingInvoice.externalId,
                status: existingInvoice.status,
                updatedAt: existingInvoice.updatedAt
            });
        }

        // Simulate 15% chance of service unavailable
        if (Math.random() < 0.15) {
            console.log('Simulating 503 Service Unavailable');

            return res.status(503).json({
                error: 'BillPort service temporarily unavailable'
            });
        }

        // Generate external invoice ID
        const externalId =
            'ext_' + crypto.randomUUID();

        const newInvoice = {
            externalId,
            status: 'QUEUED',
            sequence: 0,
            updatedAt: new Date(),
            payload: req.body
        };

        // Reserve the idempotency key immediately.
        // This prevents duplicate invoice creation
        // even when the first request is delayed.
        invoices.set(externalId, newInvoice);
        idempotencyStore.set(idempotencyKey, externalId);

        const responseData = {
            externalId,
            status: 'QUEUED',
            updatedAt: newInvoice.updatedAt
        };

        // Simulate 10% chance of a 6-second delay
        const isDelayed = Math.random() < 0.10;

        if (isDelayed) {
            console.log('Simulating 6-second delay');

            await new Promise(resolve => {
                setTimeout(resolve, 6000);
            });
        }

        // Send invoice creation response
        res.status(201).json(responseData);

        // Start asynchronous status progression
        scheduleProgress(externalId);

    } catch (error) {
        console.error('Invoice creation error:', error);

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error'
            });
        }
    }
});

// 2. GET /billing/invoices/:externalId
app.get('/billing/invoices/:externalId', (req, res) => {
    const externalId = req.params.externalId;

    const invoice = invoices.get(externalId);

    if (!invoice) {
        return res.status(404).json({
            error: 'Invoice not found'
        });
    }

    return res.status(200).json({
        externalId: invoice.externalId,
        status: invoice.status,
        sequence: invoice.sequence,
        updatedAt: invoice.updatedAt
    });
});


// Block webhook delivery.
app.post('/admin/webhooks/block', (req, res) => {
    webhookBlocked = true;

    res.json({
        success: true,
        webhookBlocked
    });
});

// Restore webhook delivery.
app.post('/admin/webhooks/unblock', (req, res) => {
    webhookBlocked = false;

    res.json({
        success: true,
        webhookBlocked
    });
});

// Replay the latest invoice webhook.
app.post('/admin/webhooks/:externalId/replay', async (req, res) => {
    const invoice = invoices.get(req.params.externalId);

    if (!invoice) {
        return res.status(404).json({
            error: 'Invoice not found'
        });
    }

    const deliveries = Number(req.body.deliveries) || 3;

    if (deliveries < 1 || deliveries > 5) {
        return res.status(400).json({
            error: 'Deliveries must be between 1 and 5'
        });
    }

    // Reuse eventId to simulate duplicate delivery.
    const eventId = crypto.randomUUID();

    for (let i = 0; i < deliveries; i++) {
        await sendWebhook(invoice, { eventId });
    }

    res.json({
        success: true,
        eventId,
        deliveries
    });
});

// Send an older sequence event to test out-of-order protection.
app.post('/admin/webhooks/:externalId/out-of-order', async (req, res) => {
    const invoice = invoices.get(req.params.externalId);

    if (!invoice) {
        return res.status(404).json({
            error: 'Invoice not found'
        });
    }

    const olderInvoice = {
        ...invoice,
        status: 'VIEWED',
        sequence: Math.max(0, invoice.sequence - 1)
    };

    await sendWebhook(olderInvoice);

    res.json({
        success: true,
        message: 'Older webhook event sent',
        sequence: olderInvoice.sequence,
        currentSequence: invoice.sequence
    });
});


// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        service: 'BillPort',
        status: 'running'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`BillPort mock service running on port ${PORT}`);
});
