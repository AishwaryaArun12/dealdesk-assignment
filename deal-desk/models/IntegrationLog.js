const mongoose = require('mongoose');
const integrationLogSchema = new mongoose.Schema({
    direction: { type: String, enum: ['outbound', 'inbound'], required: true },
    endpoint: { type: String, required: true },
    payload: { type: Object },
    response: { type: Object },
    outcome: { type: String, required: true }
}, { timestamps: true });
module.exports = mongoose.model('IntegrationLog', integrationLogSchema);