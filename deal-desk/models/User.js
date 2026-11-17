const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true } // Every user carries a branchId[cite: 19]
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);