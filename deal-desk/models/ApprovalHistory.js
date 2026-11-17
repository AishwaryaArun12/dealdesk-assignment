const mongoose = require('mongoose');
const approvalHistorySchema = new mongoose.Schema({
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true },
    step: { type: Number, required: true },
    approverRole: { type: String, required: true },
    approverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    remarks: { type: String, default: '' }
}, { timestamps: true });
module.exports = mongoose.model('ApprovalHistory', approvalHistorySchema);