
# DealDesk – Full Stack Discount Approval & Billing System

## Overview

DealDesk is a backend application for managing sales deals, discount approvals, role-based access control, deal conversations and invoice processing.

It integrates with BillPort, a separate mock billing service, for asynchronous invoice delivery and webhook-based status updates.

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT Authentication
- bcryptjs
- Socket.IO
- Axios
- HMAC SHA-256

## Project Structure

```text
deal-desk/
├── middleware/
│   ├── auth.js
│   └── guard.js
├── models/
│   ├── ApprovalConfig.js
│   ├── ApprovalHistory.js
│   ├── Branch.js
│   ├── ChatMessage.js
│   ├── ChatThread.js
│   ├── Customer.js
│   ├── Deal.js
│   ├── IntegrationLog.js
│   ├── Invoice.js
│   ├── ProcessedWebhookEvent.js
│   ├── Product.js
│   ├── Role.js
│   ├── Sale.js
│   └── User.js
├── routes/
│   ├── approvals.js
│   ├── auth.js
│   ├── deals.js
│   └── invoices.js
├── services/
│   ├── dealInvoiceService.js
│   └── invoiceService.js
├── sockets/
│   └── chatSocket.js
├── .env.example
├── .gitignore
├── package.json
├── seed.js
└── server.js
```

## Prerequisites

- Node.js 18 or later
- MongoDB
- npm
- BillPort mock service

## Installation

```bash
git clone <YOUR_DEALDESK_REPOSITORY_URL>
cd deal-desk
npm install
```

Create a `.env` file in the project root:

```env
PORT=4000
MONGO_URI=mongodb://localhost:27017/dealdesk
JWT_SECRET=replace_with_a_secure_random_secret
BILLPORT_URL=http://localhost:4001/billing/invoices
BILLPORT_SHARED_SECRET=replace_with_shared_secret
```

The `BILLPORT_SHARED_SECRET` must match the `SHARED_SECRET` configured in BillPort.

## Seed Database

Run:

```bash
npm run seed
```

The seed script creates:

- Two branches
- Four roles
- Five test users
- Sample customers
- Sample products
- Discount approval configurations

**Warning:** The seed script clears existing application collections before inserting sample data. Use only with a development database.

## Test Credentials

All seeded users have the default password:

`password123`

| Role | Email |
|---|---|
| Sales Executive – Branch A | aisha.khan@dealdesk.local |
| Sales Executive – Branch B | ben.carter@dealdesk.local |
| Sales Manager | chloe.nguyen@dealdesk.local |
| Finance | diego.alvarez@dealdesk.local |
| Admin | elena.petrova@dealdesk.local |

## Run Application

```bash
npm start
```

DealDesk runs at:

`http://localhost:4000`

## Authentication

Login endpoint:

```http
POST /auth/login
Content-Type: application/json
```

Example:

```json
{
  "email": "aisha.khan@dealdesk.local",
  "password": "password123"
}
```

Use the returned JWT token in protected API requests:

```http
Authorization: Bearer <JWT_TOKEN>
```

## Role-Based Access Control

| Role | Data Scope | Responsibilities |
|---|---|---|
| sales_exec | own | Manage own deals |
| sales_manager | branch | Review branch deals and approve discounts |
| finance | all | Finance approvals and invoice permissions |
| admin | all | Administration and configuration |

Permissions are stored in the Role collection.

## Discount Approval Configuration

Default approval bands:

| Discount | Approval Chain |
|---|---|
| 0–10% | Automatic |
| 10–25% | Sales Manager |
| 25–40% | Sales Manager → Finance |
| Above 40% | Sales Manager → Finance → Admin |

Approval configuration is stored in MongoDB and can be managed through the administrative configuration API.

## Billing Integration

DealDesk creates local Sale and Invoice records before sending invoice data to BillPort.

The integration uses:

- Idempotency keys
- HMAC SHA-256 request signatures
- Retry handling
- Persistent retry scheduling
- Webhook event deduplication
- Sequence-based stale event protection
- Invoice reconciliation
- Integration logs

## Webhook

BillPort sends invoice updates to:

```http
POST /api/billing/webhook
```

The webhook uses HMAC signature verification.

Repeated event IDs are detected to prevent duplicate processing. Older sequence numbers are ignored.

## Real-Time Chat

Socket.IO is used for real-time deal conversations.

Chat messages and threads are stored in MongoDB.

## Run BillPort

Start the BillPort service separately on port 4001.

## Environment Security

Never commit `.env` files, JWT secrets or shared integration secrets.

Use `.env.example` to document required variables without including actual credentials.

## Development Status

This repository is a development assignment implementation. Refer to the API routes and services for the implemented workflows. Any incomplete acceptance scenarios should be identified and verified before production use.
