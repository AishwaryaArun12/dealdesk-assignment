
# BillPort – Mock Billing Service

## Overview

BillPort is a standalone mock billing service used by DealDesk to simulate external invoice creation and asynchronous invoice status updates.

It supports invoice creation, idempotency, HMAC authentication, webhook delivery and invoice status retrieval.

## Tech Stack

- Node.js
- Express.js
- Crypto
- CORS

## Installation

```bash
git clone <YOUR_BILLPORT_REPOSITORY_URL>
cd bill-port
npm install
```

## Environment Variables

Create a `.env` file:

```env
PORT=4001
SHARED_SECRET=replace_with_shared_secret
DEALDESK_WEBHOOK_URL=http://localhost:4000/api/billing/webhook
```

The `SHARED_SECRET` must match DealDesk's `BILLPORT_SHARED_SECRET`.

## Start Service

```bash
npm start
```

BillPort runs at:

`http://localhost:4001`

## Health Check

```http
GET /health
```

## API Endpoints

### Create Invoice

```http
POST /billing/invoices
```

Uses an idempotency key and HMAC signature to authenticate invoice creation requests.

### Retrieve Invoice

```http
GET /billing/invoices/:externalId
```

Returns the current invoice status and sequence.

### Webhook Delivery

BillPort sends invoice status updates to DealDesk.

Supported simulated invoice statuses include:

- QUEUED
- SENT
- VIEWED
- PAID
- FAILED

Webhook requests are signed using HMAC SHA-256.

## Development Testing

The service includes administrative webhook testing endpoints for simulating:

- Webhook blocking
- Webhook recovery
- Duplicate webhook delivery
- Out-of-order webhook delivery

These development endpoints should not be exposed publicly in production.

## Integration

DealDesk and BillPort must use matching shared secrets.

Start both services separately:

```text
DealDesk: http://localhost:4000
BillPort: http://localhost:4001
```

## Important Note

Invoice storage currently uses in-memory Maps. Restarting BillPort clears its stored mock invoices and idempotency records. This service is intended for development and assignment demonstration, not production deployment.
