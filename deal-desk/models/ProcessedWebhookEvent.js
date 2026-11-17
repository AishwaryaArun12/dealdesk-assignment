
const mongoose = require('mongoose');

const processedWebhookEventSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
        unique: true
    },
    externalId: {
        type: String,
        required: true
    },
    sequence: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['processing', 'processed', 'ignored'],
        default: 'processing'
    },
    outcome: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model(
    'ProcessedWebhookEvent',
    processedWebhookEventSchema
);
