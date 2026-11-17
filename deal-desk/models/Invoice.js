const mongoose = require('mongoose');
const invoiceSchema = new mongoose.Schema({
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true },
    externalId: { type: String, default: null },
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'sent', 'viewed', 'paid', 'failed'], default: 'pending' },
    retryCount: { type: Number, default: 0 },
    nextRetryAt: {
        type: Date,
        default: null
    },
    lastAttemptAt: { type: Date, default: null },
    lastSequence: { type: Number, default: -1 }
}, { timestamps: true });
module.exports = mongoose.model('Invoice', invoiceSchema);