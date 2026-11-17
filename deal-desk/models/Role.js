const mongoose = require('mongoose');
const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // e.g., sales_exec, sales_manager, finance, admin
    permissions: [{ type: String }], // e.g., ['deal.view', 'deal.edit', 'discount.approve', 'invoice.issue', 'invoice.cancel', 'chat.send']
    dataScope: { type: String, enum: ['own', 'branch', 'all'], default: 'own' } // own | branch | all
}, { timestamps: true });
module.exports = mongoose.model('Role', roleSchema);