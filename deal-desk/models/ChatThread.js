const mongoose = require('mongoose');
const chatThreadSchema = new mongoose.Schema({
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true, unique: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });
module.exports = mongoose.model('ChatThread', chatThreadSchema);