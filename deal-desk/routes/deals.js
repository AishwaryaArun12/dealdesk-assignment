
const express = require('express');
const router = express.Router();

const Deal = require('../models/Deal');
const ApprovalConfig = require('../models/ApprovalConfig');
const ApprovalHistory = require('../models/ApprovalHistory');
const ChatThread = require('../models/ChatThread');
const User = require('../models/User');
const Role = require('../models/Role');

const auth = require('../middleware/auth');
const { guard, applyDataScope } = require('../middleware/guard');
const { createLocalInvoice } = require('../services/dealInvoiceService');

// POST /deals
// Create a deal and initialise its chat thread.
router.post('/', auth, guard('deal.edit'), async (req, res) => {
    try {
        const { title, customerId, productId, amount } = req.body;

        if (
            !title?.trim() ||
            !customerId ||
            !productId ||
            !Number.isFinite(Number(amount)) ||
            Number(amount) <= 0
        ) {
            return res.status(400).json({
                error: 'title, customerId, productId and a positive amount are required'
            });
        }

        const deal = await Deal.create({
            title: title.trim(),
            customerId,
            productId,
            amount: Number(amount),
            ownerId: req.user._id,
            branchId: req.user.branchId._id || req.user.branchId,
            status: 'open'
        });

        // Find branch managers through database permissions,
        // not hardcoded role names.
        const managerRoles = await Role.find({
            permissions: 'discount.approve',
            dataScope: 'branch'
        }).select('_id');

        const managers = managerRoles.length
            ? await User.find({
                branchId: deal.branchId,
                roleId: { $in: managerRoles.map(role => role._id) }
            }).select('_id')
            : [];

        const participants = [
            req.user._id,
            ...managers.map(manager => manager._id)
        ];

        await ChatThread.create({
            dealId: deal._id,
            participants: [
                ...new Map(
                    participants.map(id => [id.toString(), id])
                ).values()
            ]
        });

        return res.status(201).json({
            message: 'Deal created successfully',
            deal
        });

    } catch (error) {
        console.error('Create deal error:', error);
        return res.status(500).json({ error: 'Unable to create deal' });
    }
});


// GET /deals
// Data scope is applied inside the MongoDB query.
router.get('/', auth, guard('deal.view'), async (req, res) => {
    try {
        const deals = await Deal.find(applyDataScope(req, {}))
            .populate('customerId', 'name')
            .populate('productId', 'name price')
            .populate('ownerId', 'name email')
            .sort({ createdAt: -1 });

        return res.status(200).json(deals);

    } catch (error) {
        console.error('Get deals error:', error);
        return res.status(500).json({ error: 'Unable to fetch deals' });
    }
});


// GET /deals/:id
// A user cannot retrieve a deal outside their data scope.
router.get('/:id', auth, guard('deal.view'), async (req, res) => {
    try {
        const deal = await Deal.findOne(
            applyDataScope(req, { _id: req.params.id })
        )
            .populate('customerId')
            .populate('productId')
            .populate('ownerId', 'name email');

        if (!deal) {
            return res.status(404).json({
                error: 'Deal not found'
            });
        }

        const history = await ApprovalHistory.find({
            dealId: deal._id
        }).sort({ step: 1, createdAt: 1 });

        return res.status(200).json({ deal, history });

    } catch (error) {
        console.error('Get deal error:', error);
        return res.status(500).json({ error: 'Unable to fetch deal' });
    }
});


// POST /deals/:id/discount-request
// Build approval chain dynamically from database configuration.
router.post(
    '/:id/discount-request',
    auth,
    guard('deal.edit'),
    async (req, res) => {
        try {
            const discountPercentage = Number(req.body.discountPercentage);

            if (
                !Number.isFinite(discountPercentage) ||
                discountPercentage < 0 ||
                discountPercentage > 100
            ) {
                return res.status(400).json({
                    error: 'Discount must be between 0 and 100'
                });
            }

            const deal = await Deal.findOne(
                applyDataScope(req, { _id: req.params.id })
            );

            if (!deal) {
                return res.status(404).json({
                    error: 'Deal not found'
                });
            }

            if (deal.status !== 'open') {
                return res.status(400).json({
                    error: 'Only open deals can request a discount'
                });
            }

            // Read approval bands from MongoDB.
            const configs = await ApprovalConfig.find({})
                .sort({ minDiscount: 1 });

            const targetConfig = configs.find((config, index) => {
                const isAboveMinimum =
                    index === 0
                        ? discountPercentage >= config.minDiscount
                        : discountPercentage > config.minDiscount;

                return (
                    isAboveMinimum &&
                    discountPercentage <= config.maxDiscount
                );
            });

            if (!targetConfig) {
                return res.status(409).json({
                    error: 'No approval configuration found for this discount'
                });
            }

            const approverRoles = targetConfig.approverRoles || [];

            deal.discountPercentage = discountPercentage;

            // Auto-approve if configuration contains no approver roles.
            if (approverRoles.length === 0) {
                deal.status = 'won';
                await deal.save();

                const invoice = await createLocalInvoice(deal);

                return res.status(200).json({
                    message: 'Deal automatically approved',
                    deal,
                    invoiceId: invoice._id
                });
            }

            deal.status = 'pending_approval';
            await deal.save();

            // Create immutable approval history entries.
            await ApprovalHistory.insertMany(
                approverRoles.map((approverRole, index) => ({
                    dealId: deal._id,
                    step: index + 1,
                    approverRole,
                    approverId: null,
                    action: 'pending',
                    remarks: ''
                }))
            );

            // Notify users through the existing Socket.IO connection.
            const io = req.app.get('io');

            if (io) {
                io.to(deal.branchId.toString()).emit(
                    'system_notification',
                    {
                        type: 'DISCOUNT_REQUEST',
                        message: `Discount approval required for ${deal.title}`,
                        dealId: deal._id
                    }
                );
            }

            return res.status(200).json({
                message: 'Approval chain created successfully',
                approverRoles,
                deal
            });

        } catch (error) {
            console.error('Discount request error:', error);
            return res.status(500).json({
                error: 'Unable to request discount'
            });
        }
    }
);

module.exports = router;
