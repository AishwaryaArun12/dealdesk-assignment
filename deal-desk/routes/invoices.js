
const express = require('express');
const router = express.Router();

const {
    processWebhookEvent,
    verifyWebhookSignature
} = require('../services/invoiceService');

// POST /api/billing/webhook
router.post('/webhook', (req, res) => {
    const signature = req.headers['x-signature'];
    const rawBody = req.rawBody;

    // Verify signature before acknowledging the webhook.
    if (!verifyWebhookSignature(rawBody, signature)) {
        return res.status(401).json({
            success: false,
            message: 'Invalid webhook signature'
        });
    }

    // Immediately acknowledge valid webhooks.
    res.status(200).json({
        received: true
    });

    // Process asynchronously after acknowledgement.
    processWebhookEvent(
        req.body,
        rawBody,
        signature,
        req.app.get('io')
    ).catch(error => {
        console.error(
            'Webhook processing error:',
            error.message
        );
    });
});

module.exports = router;
