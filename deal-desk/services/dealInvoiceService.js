
const Sale = require('../models/Sale');
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const { pushInvoiceToBillPort } = require('./invoiceService');

async function createLocalInvoice(deal) {
    // 1. Create exactly one Sale per deal.
   
    // 1. Create exactly one Sale per deal.
    const saleData = {
        dealId: deal._id,
        customerId: deal.customerId,
        productId: deal.productId,
        amount: deal.amount
    };

    let sale;
    let saleCreated = false;

    try {
        const result = await Sale.findOneAndUpdate(
            { dealId: deal._id },
            { $setOnInsert: saleData },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
                includeResultMetadata: true
            }
        );

        sale = result.value;
        saleCreated = Boolean(result.lastErrorObject?.upserted);

    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }

        sale = await Sale.findOne({ dealId: deal._id });

        if (!sale) {
            throw error;
        }
    }

    // 2. Increase customer balance only for a newly created Sale.
    if (saleCreated) {
        await Customer.updateOne(
            { _id: deal.customerId },
            { $inc: { outstandingBalance: deal.amount } }
        );
    }

    // 3. Create exactly one Invoice per deal.
    const idempotencyKey = `deal_inv_${deal._id}`;

    let invoice;

    try {
        invoice = await Invoice.findOneAndUpdate(
            { idempotencyKey },
            {
                $setOnInsert: {
                    dealId: deal._id,
                    idempotencyKey,
                    status: 'pending'
                }
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }
        );
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }

        invoice = await Invoice.findOne({ idempotencyKey });

        if (!invoice) {
            throw error;
        }
    }

    // 4. Push to BillPort asynchronously.
    // Local Sale and Invoice are saved before the external request.
    if (
        !invoice.externalId &&
        invoice.status !== 'paid' &&
        invoice.status !== 'failed'
    ) {
        setImmediate(() => {
            pushInvoiceToBillPort(invoice._id).catch(error => {
                console.error(
                    'BillPort invoice push failed:',
                    error.message
                );
            });
        });
    }

    return invoice;
}

module.exports = {
    createLocalInvoice
};
