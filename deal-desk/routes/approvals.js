
const express = require('express');
const router = express.Router();

const Deal = require('../models/Deal');
const ApprovalConfig = require('../models/ApprovalConfig');
const ApprovalHistory = require('../models/ApprovalHistory');
const Role = require('../models/Role');

const auth = require('../middleware/auth');
const { guard, applyDataScope } = require('../middleware/guard');
const { createLocalInvoice } = require('../services/dealInvoiceService');

function getRoleName(user) {
    return user?.roleId?.name || null;
}

// Get the latest event for every approval step.
// Previous events are never updated or deleted.
async function getLatestApprovalEvents(dealId) {
    const events = await ApprovalHistory.find({ dealId })
        .sort({ createdAt: -1, _id: -1 });

    const latestByStep = new Map();

    for (const event of events) {
        if (!latestByStep.has(event.step)) {
            latestByStep.set(event.step, event);
        }
    }

    return [...latestByStep.values()].sort(
        (a, b) => a.step - b.step
    );
}

// --------------------------------------------------
// GET /approvals/config
// Admin: view approval configuration
// --------------------------------------------------

router.get(
    '/config',
    auth,
    guard('config.manage'),
    async (req, res) => {
        try {
            const bands = await ApprovalConfig.find({})
                .sort({ minDiscount: 1 });

            return res.json(bands);
        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// PUT /approvals/config
// Admin: update approval configuration
// --------------------------------------------------

router.put(
    '/config',
    auth,
    guard('config.manage'),
    async (req, res) => {
        try {
            const { bands } = req.body;

            if (!Array.isArray(bands) || bands.length === 0) {
                return res.status(400).json({
                    error: 'bands must be a non-empty array'
                });
            }

            const normalized = bands
                .map((band) => ({
                    minDiscount: Number(band.minDiscount),
                    maxDiscount: Number(band.maxDiscount),
                    approverRoles: Array.isArray(band.approverRoles)
                        ? band.approverRoles.map(String)
                        : null
                }))
                .sort((a, b) => a.minDiscount - b.minDiscount);

            for (let i = 0; i < normalized.length; i++) {
                const band = normalized[i];

                if (
                    !Number.isFinite(band.minDiscount) ||
                    !Number.isFinite(band.maxDiscount) ||
                    band.minDiscount < 0 ||
                    band.maxDiscount > 100 ||
                    band.maxDiscount <= band.minDiscount ||
                    !Array.isArray(band.approverRoles)
                ) {
                    return res.status(400).json({
                        error: 'Invalid discount band'
                    });
                }

                if (
                    i > 0 &&
                    normalized[i - 1].maxDiscount !== band.minDiscount
                ) {
                    return res.status(400).json({
                        error: 'Discount bands must be continuous and must not overlap'
                    });
                }
            }

            if (
                normalized[0].minDiscount !== 0 ||
                normalized[normalized.length - 1].maxDiscount !== 100
            ) {
                return res.status(400).json({
                    error: 'Discount bands must cover 0 to 100'
                });
            }

            // Verify that every configured approver role exists.
            const roleNames = [
                ...new Set(
                    normalized.flatMap((band) => band.approverRoles)
                )
            ];

            const existingRoles = await Role.find({
                name: { $in: roleNames }
            }).select('name');

            const existingRoleNames = new Set(
                existingRoles.map((role) => role.name)
            );

            const unknownRoles = roleNames.filter(
                (name) => !existingRoleNames.has(name)
            );

            if (unknownRoles.length > 0) {
                return res.status(400).json({
                    error: 'Unknown approver roles',
                    roles: unknownRoles
                });
            }

            await ApprovalConfig.deleteMany({});

            const savedBands = await ApprovalConfig.insertMany(normalized);

            return res.json({
                message: 'Approval configuration updated',
                bands: savedBands
            });
        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// GET /approvals/pending
// Get only the current user's actionable approvals
// --------------------------------------------------

router.get(
    '/pending',
    auth,
    guard('discount.approve'),
    async (req, res) => {
        try {
            const roleName = getRoleName(req.user);

            if (!roleName) {
                return res.status(403).json({
                    error: 'User role not found'
                });
            }

            const pendingSteps = await ApprovalHistory.find({
                approverRole: roleName,
                action: 'pending'
            }).populate({
                path: 'dealId',
                match: applyDataScope(req, {})
            });

            const result = [];

            for (const step of pendingSteps) {
                const deal = step.dealId;

                if (!deal || deal.status !== 'pending_approval') {
                    continue;
                }

                if (
                    deal.ownerId.toString() === req.user._id.toString()
                ) {
                    continue;
                }

                const latestEvents = await getLatestApprovalEvents(
                    deal._id
                );

                const currentStep = latestEvents.find(
                    (event) => event.step === step.step
                );

                if (
                    !currentStep ||
                    currentStep._id.toString() !== step._id.toString()
                ) {
                    continue;
                }

                // A step is actionable only after the previous
                // step has been approved.
                if (step.step > 1) {
                    const previousStep = latestEvents.find(
                        (event) => event.step === step.step - 1
                    );

                    if (!previousStep || previousStep.action !== 'approved') {
                        continue;
                    }
                }

                result.push({
                    approval: step,
                    deal
                });
            }

            return res.json(result);
        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// POST /approvals/:id/approve
// Approve the current user's assigned step
// --------------------------------------------------

router.post(
    '/:id/approve',
    auth,
    guard('discount.approve'),
    async (req, res) => {
        try {
            const pendingEvent = await ApprovalHistory.findById(
                req.params.id
            );

            if (!pendingEvent || pendingEvent.action !== 'pending') {
                return res.status(404).json({
                    error: 'Pending approval step not found'
                });
            }

            const latestEvents = await getLatestApprovalEvents(
                pendingEvent.dealId
            );

            const currentStep = latestEvents.find(
                (event) => event.step === pendingEvent.step
            );

            if (
                !currentStep ||
                currentStep._id.toString() !== pendingEvent._id.toString()
            ) {
                return res.status(409).json({
                    error: 'This approval step is no longer active'
                });
            }

            const deal = await Deal.findOne(
                applyDataScope(req, {
                    _id: pendingEvent.dealId
                })
            );

            if (!deal) {
                return res.status(404).json({
                    error: 'Deal not found or unauthorized'
                });
            }

            if (deal.status !== 'pending_approval') {
                return res.status(409).json({
                    error: 'Deal is not awaiting approval'
                });
            }

            if (
                deal.ownerId.toString() === req.user._id.toString()
            ) {
                return res.status(403).json({
                    error: 'Self-approval is not allowed'
                });
            }

            if (
                getRoleName(req.user) !== pendingEvent.approverRole
            ) {
                return res.status(403).json({
                    error: 'This approval step is not assigned to your role'
                });
            }

            if (pendingEvent.step > 1) {
                const previousStep = latestEvents.find(
                    (event) => event.step === pendingEvent.step - 1
                );

                if (!previousStep || previousStep.action !== 'approved') {
                    return res.status(409).json({
                        error: 'Previous approval step is still pending'
                    });
                }
            }

            // Append a new event. Never update the pending event.
            await ApprovalHistory.create({
                dealId: deal._id,
                step: pendingEvent.step,
                approverRole: pendingEvent.approverRole,
                approverId: req.user._id,
                action: 'approved',
                remarks: req.body.remarks || ''
            });

            const updatedEvents = await getLatestApprovalEvents(
                deal._id
            );

            const allApproved = updatedEvents.every(
                (event) => event.action === 'approved'
            );

            let invoice = null;

            if (allApproved) {
                deal.status = 'won';
                await deal.save();

                // Create the local sale and invoice.
                // BillPort push runs in the background.
                invoice = await createLocalInvoice(deal);
            }

            const io = req.app.get('io');

            if (io) {
                io.to(deal.ownerId.toString()).emit(
                    'system_notification',
                    {
                        type: 'APPROVAL_UPDATE',
                        message: allApproved
                            ? `Your deal "${deal.title}" was approved.`
                            : `An approval step for "${deal.title}" was approved.`,
                        dealId: deal._id,
                        status: deal.status
                    }
                );
            }

            return res.json({
                message: allApproved
                    ? 'All approval steps completed. Deal marked as won.'
                    : 'Approval step approved successfully.',
                deal,
                invoiceId: invoice?._id || null
            });
        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }
);

// --------------------------------------------------
// POST /approvals/:id/reject
// Reject the request and reset the deal
// --------------------------------------------------

router.post(
    '/:id/reject',
    auth,
    guard('discount.approve'),
    async (req, res) => {
        try {
            const pendingEvent = await ApprovalHistory.findById(
                req.params.id
            );

            if (!pendingEvent || pendingEvent.action !== 'pending') {
                return res.status(404).json({
                    error: 'Pending approval step not found'
                });
            }

            const latestEvents = await getLatestApprovalEvents(
                pendingEvent.dealId
            );

            const currentStep = latestEvents.find(
                (event) => event.step === pendingEvent.step
            );

            if (
                !currentStep ||
                currentStep._id.toString() !== pendingEvent._id.toString()
            ) {
                return res.status(409).json({
                    error: 'This approval step is no longer active'
                });
            }

            const deal = await Deal.findOne(
                applyDataScope(req, {
                    _id: pendingEvent.dealId
                })
            );

            if (!deal) {
                return res.status(404).json({
                    error: 'Deal not found or unauthorized'
                });
            }

            if (deal.status !== 'pending_approval') {
                return res.status(409).json({
                    error: 'Deal is not awaiting approval'
                });
            }

            if (
                deal.ownerId.toString() === req.user._id.toString()
            ) {
                return res.status(403).json({
                    error: 'Self-rejection is not allowed'
                });
            }

            if (
                getRoleName(req.user) !== pendingEvent.approverRole
            ) {
                return res.status(403).json({
                    error: 'This approval step is not assigned to your role'
                });
            }

            if (pendingEvent.step > 1) {
                const previousStep = latestEvents.find(
                    (event) => event.step === pendingEvent.step - 1
                );

                if (!previousStep || previousStep.action !== 'approved') {
                    return res.status(409).json({
                        error: 'Previous approval step is still pending'
                    });
                }
            }

            // Append rejection event.
            await ApprovalHistory.create({
                dealId: deal._id,
                step: pendingEvent.step,
                approverRole: pendingEvent.approverRole,
                approverId: req.user._id,
                action: 'rejected',
                remarks: req.body.remarks || 'Rejected'
            });

            // Cancel every remaining pending step without
            // modifying or deleting previous history.
            for (const event of latestEvents) {
                if (event.action === 'pending') {
                    await ApprovalHistory.create({
                        dealId: deal._id,
                        step: event.step,
                        approverRole: event.approverRole,
                        approverId: null,
                        action: 'cancelled',
                        remarks: 'Cancelled because the approval request was rejected'
                    });
                }
            }

            deal.status = 'open';
            deal.discountPercentage = 0;
            await deal.save();

            const io = req.app.get('io');

            if (io) {
                io.to(deal.ownerId.toString()).emit(
                    'system_notification',
                    {
                        type: 'APPROVAL_UPDATE',
                        message: `Your discount request for "${deal.title}" was rejected.`,
                        dealId: deal._id,
                        status: deal.status,
                        remarks: req.body.remarks || 'Rejected'
                    }
                );
            }

            return res.json({
                message: 'Discount request rejected. Deal returned to open.',
                deal
            });
        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }
);

module.exports = router;
