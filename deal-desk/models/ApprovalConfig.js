const mongoose = require('mongoose');
const approvalConfigSchema = new mongoose.Schema({
    minDiscount: { type: Number, required: true }, // inclusive
    maxDiscount: { type: Number, required: true }, // exclusive or upper limit
    approverRoles: [{ type: String }] // Array of role names in sequence, e.g., ['sales_manager', 'finance']
}, { timestamps: true });
module.exports = mongoose.model('ApprovalConfig', approvalConfigSchema);