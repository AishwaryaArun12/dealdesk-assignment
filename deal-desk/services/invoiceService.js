
const crypto = require('crypto');
const axios = require('axios');

const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');
const Customer = require('../models/Customer');
const IntegrationLog = require('../models/IntegrationLog');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');

const BILLPORT_URL = process.env.BILLPORT_URL || 'http://localhost:4001/billing/invoices';
const SHARED_SECRET = process.env.BILLPORT_SHARED_SECRET;

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;
const REQUEST_TIMEOUT = 5000;

const activePushes = new Set();

function verifyWebhookSignature(rawBody, signature) {
    if (!SHARED_SECRET || !rawBody || !signature) {
        return false;
    }

    const suppliedSignature = String(signature).replace(/^sha256=/i, '');
    const expectedSignature = crypto
        .createHmac('sha256', SHARED_SECRET)
        .update(rawBody)
        .digest('hex');

    try {
        const supplied = Buffer.from(suppliedSignature, 'hex');
        const expected = Buffer.from(expectedSignature, 'hex');

        return supplied.length === expected.length &&
            crypto.timingSafeEqual(supplied, expected);
    } catch {
        return false;
    }
}

function mapBillPortStatus(status) {
    const value = String(status || '').toUpperCase();

    const statusMap = {
        QUEUED: 'sent',
        SENT: 'sent',
        VIEWED: 'viewed',
        PAID: 'paid',
        FAILED: 'failed'
    };

    return statusMap[value] || null;
}

async function writeIntegrationLog(data) {
    try {
        await IntegrationLog.create(data);
    } catch (error) {
        console.error('Integration log error:', error.message);
    }
}

/**
 * Updates invoice status only if the incoming sequence is newer.
 * Customer balance is deducted only on the first transition to paid.
 */
async function applyInvoiceStatus(invoice, newStatus, sequence) {
    if (!invoice || !newStatus) {
        return { updated: false, reason: 'Invalid invoice or status' };
    }

    const incomingSequence = Number(sequence);

    if (!Number.isFinite(incomingSequence)) {
        return { updated: false, reason: 'Invalid sequence number' };
    }

    const currentInvoice = await Invoice.findById(invoice._id);

    if (!currentInvoice) {
        return { updated: false, reason: 'Invoice not found' };
    }

    if (incomingSequence <= currentInvoice.lastSequence) {
        return { updated: false, reason: 'Stale event' };
    }

    const wasAlreadyPaid = currentInvoice.status === 'paid';

    // Atomic sequence guard: only one event can advance this invoice
    // from its current sequence number.
    const updatedInvoice = await Invoice.findOneAndUpdate(
        {
            _id: currentInvoice._id,
            lastSequence: currentInvoice.lastSequence
        },
        {
            $set: {
                status: wasAlreadyPaid ? 'paid' : newStatus,
                lastSequence: incomingSequence
            }
        },
        { new: true }
    );

    if (!updatedInvoice) {
        return { updated: false, reason: 'Invoice was updated concurrently' };
    }

    if (newStatus === 'paid' && !wasAlreadyPaid) {
        const deal = await Deal.findById(updatedInvoice.dealId);

        if (deal) {
            await Customer.updateOne(
                { _id: deal.customerId },
                { $inc: { outstandingBalance: -deal.amount } }
            );
        }
    }

    return {
        updated: true,
        invoice: updatedInvoice,
        reason: wasAlreadyPaid ? 'Already paid' : 'Status updated'
    };
}

/**
 * Sends a local invoice to BillPort.
 * Retry timing is stored in MongoDB so retries survive server restarts.
 */
async function pushInvoiceToBillPort(invoiceId) {
    if (activePushes.has(String(invoiceId))) {
        return;
    }

    activePushes.add(String(invoiceId));

    try {
        const invoice = await Invoice.findById(invoiceId);

        if (!invoice || invoice.externalId || invoice.status === 'paid' ||
            invoice.status === 'failed') {
            return;
        }

        if (!SHARED_SECRET) {
            throw new Error('BILLPORT_SHARED_SECRET is missing from environment');
        }

        const deal = await Deal.findById(invoice.dealId)
            .populate('customerId');

        if (!deal) {
            throw new Error('Related deal not found');
        }

        const payload = {
            idempotencyKey: invoice.idempotencyKey,
            dealId: String(deal._id),
            amount: deal.amount,
            customerName: deal.customerId?.name || 'Customer'
        };

        const rawPayload = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', SHARED_SECRET)
            .update(rawPayload)
            .digest('hex');

        await Invoice.updateOne(
            { _id: invoice._id },
            { $set: { lastAttemptAt: new Date() } }
        );

        const response = await axios.post(BILLPORT_URL, payload, {
            timeout: REQUEST_TIMEOUT,
            headers: {
                'Content-Type': 'application/json',
                'x-signature': signature,
                'Idempotency-Key': invoice.idempotencyKey
            }
        });

        const responseData = response.data?.data || response.data || {};
        const externalId =
            responseData.invoiceId ||
            responseData.externalId ||
            responseData._id ||
            responseData.id;

        if (!externalId) {
            throw new Error('BillPort response did not contain an invoice ID');
        }

        await Invoice.updateOne(
            { _id: invoice._id },
            {
                $set: {
                    externalId: String(externalId),
                    status: 'sent',
                    nextRetryAt: null
                }
            }
        );

        await writeIntegrationLog({
            direction: 'outbound',
            endpoint: BILLPORT_URL,
            payload,
            response: response.data,
            outcome: 'success'
        });
    } catch (error) {
        const invoice = await Invoice.findById(invoiceId);

        if (invoice && !invoice.externalId && invoice.status !== 'paid') {
            const retryCount = invoice.retryCount + 1;
            const terminalFailure = retryCount >= MAX_RETRIES;

            const delay = Math.min(
                BASE_RETRY_DELAY * Math.pow(2, retryCount - 1),
                MAX_RETRY_DELAY
            );

            await Invoice.updateOne(
                { _id: invoice._id },
                {
                    $set: {
                        retryCount,
                        lastAttemptAt: new Date(),
                        status: terminalFailure ? 'failed' : 'pending',
                        nextRetryAt: terminalFailure
                            ? null
                            : new Date(Date.now() + delay)
                    }
                }
            );

            await writeIntegrationLog({
                direction: 'outbound',
                endpoint: BILLPORT_URL,
                payload: { invoiceId: String(invoiceId) },
                response: { message: error.message },
                outcome: terminalFailure
                    ? 'failed_after_max_retries'
                    : `retry_scheduled_${retryCount}`
            });
        }

        console.error('BillPort push error:', error.message);
    } finally {
        activePushes.delete(String(invoiceId));
    }
}

/**
 * Processes a signed BillPort webhook.
 * eventId is stored in a separate collection with a unique index.
 */
async function processWebhookEvent(payload, rawBody, signature, io) {
    if (!verifyWebhookSignature(rawBody, signature)) {
        throw new Error('Invalid webhook signature');
    }

    const eventId = payload.eventId;
    const externalId =
        payload.externalId ||
        payload.invoiceId ||
        payload.id;

    const incomingStatus = mapBillPortStatus(payload.status);
    const sequence = Number(payload.sequence);

    if (!eventId || !externalId || !incomingStatus ||
        !Number.isFinite(sequence)) {
        throw new Error('Webhook payload is missing required fields');
    }

    let eventRecord;

    try {
        eventRecord = await ProcessedWebhookEvent.create({
            eventId: String(eventId),
            externalId: String(externalId),
            sequence,
            status: 'processing'
        });
    } catch (error) {
        if (error.code === 11000) {
            await writeIntegrationLog({
                direction: 'inbound',
                endpoint: '/webhook',
                payload,
                response: { eventId },
                outcome: 'ignored_duplicate'
            });

            return { ignored: true, reason: 'Duplicate event' };
        }

        throw error;
    }

    try {
        const invoice = await Invoice.findOne({
            externalId: String(externalId)
        });

        if (!invoice) {
            await ProcessedWebhookEvent.updateOne(
                { _id: eventRecord._id },
                {
                    $set: {
                        status: 'ignored',
                        outcome: 'Invoice not found'
                    }
                }
            );

            await writeIntegrationLog({
                direction: 'inbound',
                endpoint: '/webhook',
                payload,
                response: {},
                outcome: 'ignored_invoice_not_found'
            });

            return { ignored: true, reason: 'Invoice not found' };
        }

        const result = await applyInvoiceStatus(
            invoice,
            incomingStatus,
            sequence
        );

        const finalEventStatus = result.updated ? 'processed' : 'ignored';

        await ProcessedWebhookEvent.updateOne(
            { _id: eventRecord._id },
            {
                $set: {
                    status: finalEventStatus,
                    outcome: result.reason
                }
            }
        );

        await writeIntegrationLog({
            direction: 'inbound',
            endpoint: '/webhook',
            payload,
            response: result,
            outcome: result.updated
                ? 'processed'
                : `ignored_${result.reason.toLowerCase().replace(/\s+/g, '_')}`
        });

        if (result.updated && result.invoice.status === 'paid' && io) {
            io.emit('invoice_paid', {
                invoiceId: String(result.invoice._id),
                dealId: String(result.invoice.dealId)
            });
        }

        return result;
    } catch (error) {
        // Remove the reservation so BillPort can retry this event.
        await ProcessedWebhookEvent.deleteOne({ _id: eventRecord._id });
        throw error;
    }
}

/**
 * Checks BillPort for invoices whose status may have changed
 * without a webhook reaching DealDesk.
 */
async function reconcileInvoices(io) {
    const invoices = await Invoice.find({
        externalId: { $ne: null },
        status: { $in: ['sent', 'viewed', 'pending'] }
    });

    for (const invoice of invoices) {
        try {
            const response = await axios.get(
                `${BILLPORT_URL}/${encodeURIComponent(invoice.externalId)}`,
                { timeout: REQUEST_TIMEOUT }
            );

            const data = response.data?.data || response.data || {};
            const newStatus = mapBillPortStatus(data.status);

            if (!newStatus) {
                continue;
            }

            const sequence = Number.isFinite(Number(data.sequence))
                ? Number(data.sequence)
                : invoice.lastSequence + 1;

            const result = await applyInvoiceStatus(
                invoice,
                newStatus,
                sequence
            );

            if (result.updated && newStatus === 'paid' && io) {
                io.emit('invoice_paid', {
                    invoiceId: String(invoice._id),
                    dealId: String(invoice.dealId)
                });
            }

            if (result.updated) {
                await writeIntegrationLog({
                    direction: 'inbound',
                    endpoint: `${BILLPORT_URL}/${invoice.externalId}`,
                    payload: data,
                    response: result,
                    outcome: 'reconciled'
                });
            }
        } catch (error) {
            console.error(
                `Invoice reconciliation failed (${invoice._id}):`,
                error.message
            );
        }
    }
}

/**
 * Starts persistent retry processing and periodic reconciliation.
 */
function initReconciliationJob(io) {
    // Process invoices whose retry time has arrived.
    setInterval(async () => {
        try {
            const dueInvoices = await Invoice.find({
                status: 'pending',
                externalId: null,
                retryCount: { $lt: MAX_RETRIES },
                nextRetryAt: { $ne: null, $lte: new Date() }
            }).select('_id');

            for (const invoice of dueInvoices) {
                pushInvoiceToBillPort(invoice._id).catch(error => {
                    console.error('Scheduled retry error:', error.message);
                });
            }
        } catch (error) {
            console.error('Retry scheduler error:', error.message);
        }
    }, 5000);

    // Reconcile external invoice statuses every two minutes.
    setInterval(() => {
        reconcileInvoices(io).catch(error => {
            console.error('Reconciliation job error:', error.message);
        });
    }, 120000);
}

module.exports = {
    pushInvoiceToBillPort,
    processWebhookEvent,
    initReconciliationJob,
    verifyWebhookSignature
};
