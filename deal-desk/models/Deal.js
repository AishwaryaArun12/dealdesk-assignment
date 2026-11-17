const mongoose = require('mongoose');
const dealSchema = new mongoose.Schema({
    title: { type: String, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    amount: { type: Number, required: true },
    discountPercentage: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'pending_approval', 'won', 'rejected'], default: 'open' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true }
}, { timestamps: true });
module.exports = mongoose.model('Deal', dealSchema);