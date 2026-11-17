const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const Branch = require('./models/Branch');
const Role = require('./models/Role');
const User = require('./models/User');
const Customer = require('./models/Customer');
const Product = require('./models/Product');
const ApprovalConfig = require('./models/ApprovalConfig');
const Deal = require('./models/Deal');
const ApprovalHistory = require('./models/ApprovalHistory');
const ChatThread = require('./models/ChatThread');
const ChatMessage = require('./models/ChatMessage');
const Invoice = require('./models/Invoice');
const IntegrationLog = require('./models/IntegrationLog');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dealdesk';
const DEFAULT_PASSWORD = 'password123';

async function seed() {
    await mongoose.connect(MONGO_URI);

    await Promise.all([
        Deal.deleteMany({}),
        ApprovalHistory.deleteMany({}),
        ChatMessage.deleteMany({}),
        ChatThread.deleteMany({}),
        Invoice.deleteMany({}),
        IntegrationLog.deleteMany({}),
        ApprovalConfig.deleteMany({}),
        User.deleteMany({}),
        Customer.deleteMany({}),
        Product.deleteMany({}),
        Role.deleteMany({}),
        Branch.deleteMany({})
    ]);

    const [branchA, branchB] = await Branch.insertMany([
        { name: 'Branch A' },
        { name: 'Branch B' }
    ]);

    const [salesExec, salesManager, finance, admin] = await Role.insertMany([
        {
            name: 'sales_exec',
            permissions: ['deal.view', 'deal.edit', 'chat.send'],
            dataScope: 'own'
        },
        {
            name: 'sales_manager',
            permissions: ['deal.view', 'deal.edit', 'discount.approve', 'chat.send'],
            dataScope: 'branch'
        },
        {
            name: 'finance',
            permissions: ['deal.view', 'discount.approve', 'invoice.issue', 'invoice.cancel', 'chat.send'],
            dataScope: 'all'
        },
        {
            name: 'admin',
            permissions: [
                'deal.view',
                'deal.edit',
                'discount.approve',
                'invoice.issue',
                'invoice.cancel',
                'chat.send',
                'config.manage'
            ],
            dataScope: 'all'
        }
    ]);

    const password = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    await User.insertMany([
        {
            name: 'Aisha Khan',
            email: 'aisha.khan@dealdesk.local',
            password,
            roleId: salesExec._id,
            branchId: branchA._id
        },
        {
            name: 'Ben Carter',
            email: 'ben.carter@dealdesk.local',
            password,
            roleId: salesExec._id,
            branchId: branchB._id
        },
        {
            name: 'Chloe Nguyen',
            email: 'chloe.nguyen@dealdesk.local',
            password,
            roleId: salesManager._id,
            branchId: branchA._id
        },
        {
            name: 'Diego Alvarez',
            email: 'diego.alvarez@dealdesk.local',
            password,
            roleId: finance._id,
            branchId: branchB._id
        },
        {
            name: 'Elena Petrova',
            email: 'elena.petrova@dealdesk.local',
            password,
            roleId: admin._id,
            branchId: branchA._id
        }
    ]);

    await Customer.insertMany([
        { name: 'Acme Corp', outstandingBalance: 0 },
        { name: 'Northwind Traders', outstandingBalance: 15000 },
        { name: 'Globex Industries', outstandingBalance: 4200 }
    ]);

    await Product.insertMany([
        { name: 'CRM License', price: 50000 },
        { name: 'Support Plan', price: 12000 },
        { name: 'Analytics Add-on', price: 8000 }
    ]);

    // minDiscount is inclusive. maxDiscount is the upper bound of the band.
    // The top band uses 101 so a 100% discount still matches when max is treated as exclusive.
    await ApprovalConfig.insertMany([
        { minDiscount: 0, maxDiscount: 10, approverRoles: [] },
        { minDiscount: 10, maxDiscount: 25, approverRoles: ['sales_manager'] },
        { minDiscount: 25, maxDiscount: 40, approverRoles: ['sales_manager', 'finance'] },
        { minDiscount: 40, maxDiscount: 101, approverRoles: ['sales_manager', 'finance', 'admin'] }
    ]);

    console.log('Seed completed successfully');
    await mongoose.disconnect();
}

seed().catch(async (err) => {
    console.error('Seed failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
