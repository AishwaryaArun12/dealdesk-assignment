\# DealDesk + BillPort Integration



A full-stack deal management and billing integration system built with Node.js, Express, MongoDB, and a mock external billing service.



\## 1. Project Structure





dealdesk-assignment/

├── deal-desk/       # Main DealDesk application (port 4000)

├── bill-port/       # Mock billing service (port 4001)

├── client/          # Frontend application

├── postman/         # API testing collection

└── README.md

```



\## 2. Prerequisites



\- Node.js

\- npm

\- MongoDB running locally or a MongoDB connection URI

\- Postman (for API testing)



\## 3. Installation and Setup



\### DealDesk



```bash

cd deal-desk

npm install

```



Copy `.env.example` to `.env` and configure:



```env

PORT=4000

MONGO\_URI=mongodb://localhost:27017/dealdesk

JWT\_SECRET=replace\_with\_a\_secure\_secret

BILLPORT\_URL=http://localhost:4001/billing/invoices

BILLPORT\_SHARED\_SECRET=your\_shared\_secret

```



\### BillPort



Open another terminal:



```bash

cd bill-port

npm install

```



Copy `.env.example` to `.env` and configure:



```env

PORT=4001

SHARED\_SECRET=your\_shared\_secret

DEALDESK\_WEBHOOK\_URL=http://localhost:4000/api/billing/webhook

```



\*\*Important:\*\* `BILLPORT\_SHARED\_SECRET` in DealDesk and `SHARED\_SECRET` in BillPort must have exactly the same value.



\### Seed the database



From the DealDesk directory:



```bash

npm run seed

```



This creates sample branches, roles, users, customers, products, and approval configuration.



\*\*Warning:\*\* The seed script clears existing application collections before inserting sample data. Run it only against a development or disposable database.



\### Start the applications



Terminal 1:



```bash

cd deal-desk

npm start

```



Terminal 2:



```bash

cd bill-port

npm start

```



DealDesk runs on `http://localhost:4000`.



BillPort runs on `http://localhost:4001`.



\## 4. Sample Login Credentials



All seeded users use the password:



`password123`



| User | Email | Role | Branch |

|---|---|---|---|

| Aisha Khan | aisha.khan@dealdesk.local | Sales Executive | Branch A |

| Ben Carter | ben.carter@dealdesk.local | Sales Executive | Branch B |

| Chloe Nguyen | chloe.nguyen@dealdesk.local | Sales Manager | Branch A |

| Diego Alvarez | diego.alvarez@dealdesk.local | Finance | Branch B |

| Elena Petrova | elena.petrova@dealdesk.local | Admin | Branch A |



\## 5. Permissions and Data Scope



The application uses role-based access control (RBAC).



Each role has an associated permission set and data scope.



\- \*\*Sales Executive:\*\* Can view and edit their own deals.

\- \*\*Sales Manager:\*\* Can view and edit deals within their branch and approve discounts.

\- \*\*Finance:\*\* Can view all deals, approve discounts, and issue or cancel invoices.

\- \*\*Admin:\*\* Has administrative permissions, including approval configuration management.



The authentication middleware verifies the JWT, retrieves the current user from MongoDB, and loads the associated role and branch.



Route-level permission middleware checks whether the user has the required permission.



Data scope is applied when retrieving deals:



\- `own`: Records belonging to the current user.

\- `branch`: Records belonging to the user's branch.

\- `all`: Records across all branches.



\## 6. Approval Workflow



Discount approval rules are stored in MongoDB and can be updated by an authorized administrator.



The default approval bands are:



| Discount | Required Approvers |

|---|---|

| 0–less than 10% | Automatic approval |

| 10–less than 25% | Sales Manager |

| 25–less than 40% | Sales Manager → Finance |

| 40–100% | Sales Manager → Finance → Admin |



When a discount is requested:



1\. DealDesk retrieves the applicable approval configuration.

2\. It determines the required approval roles.

3\. If no approval is required, the deal is automatically approved.

4\. Otherwise, approval history records are created for the required steps.

5\. Each approver must complete their assigned step before the next step becomes active.

6\. Once all required approvals are completed, the deal is marked as won and invoice creation begins.

7\. A rejection records the rejection and cancels the remaining approval steps.



Approval history is maintained as an append-only record of workflow actions.



\## 7. Invoice Integration and Retry Handling



After approval, DealDesk creates a local invoice and sends it to BillPort.



The outbound integration uses:



\- HMAC-SHA256 request signing.

\- A stable invoice idempotency key.

\- An `Idempotency-Key` HTTP header.

\- A request timeout of 5 seconds.



If BillPort is temporarily unavailable or a request fails, DealDesk retries using exponential backoff.



Retry configuration:



\- Maximum attempts: 5

\- Initial delay: 1 second

\- Maximum delay: 30 seconds



The retry count, last attempt time, and next retry time are stored in MongoDB. A background job checks for invoices whose retry time has arrived.



BillPort uses the idempotency key to return an existing invoice instead of creating another one when it receives a duplicate request.



This provides idempotent invoice creation for repeated requests while BillPort's idempotency records remain available.



\## 8. Webhook Security and Processing



BillPort sends invoice status updates to:



`POST /api/billing/webhook`



DealDesk verifies the HMAC-SHA256 signature against the original raw request body before accepting the webhook.



Webhook processing includes:



\### Duplicate event handling



Each webhook has a unique `eventId`.



DealDesk stores processed event IDs in a separate MongoDB collection with a unique index. Duplicate event IDs are ignored.



\### Out-of-order event handling



Each invoice has a `lastSequence` value.



DealDesk applies an incoming status only when its sequence number is greater than the stored sequence number. Older or repeated sequence numbers are ignored.



This prevents an older event from overwriting a newer invoice status.



\### Invoice status updates



BillPort can send statuses such as:



\- QUEUED

\- SENT

\- VIEWED

\- PAID

\- FAILED



DealDesk maps these to its internal invoice statuses.



When an invoice transitions to paid, the related customer's outstanding balance is reduced.



\## 9. Reconciliation and Recovery



DealDesk periodically checks BillPort for invoice statuses that may have changed without a webhook reaching the application.



The reconciliation job runs every two minutes and compares the external invoice status and sequence number with the local invoice record.



This provides a recovery mechanism for missed webhook deliveries.



\## 10. API Testing



Import the Postman collection:



`postman/DealDesk-BillPort.postman\_collection.json`



The collection contains requests for:



\- Authentication

\- Deal creation and retrieval

\- Discount requests

\- Approval configuration

\- Pending approvals

\- Approve and reject actions

\- Invoice creation and retrieval

\- Webhook delivery

\- Duplicate webhook replay

\- Out-of-order webhook testing

\- Webhook blocking and unblocking

\- Health checks



Update the collection variables and shared secret to match your local environment before running the requests.



\## 11. Known Limitations and Future Improvements



Given additional development time, I would improve the following areas:



1\. Use persistent storage in BillPort for invoices and idempotency records instead of in-memory Maps.

2\. Use MongoDB transactions for atomic invoice status and customer balance updates.

3\. Add recovery for webhook events that remain in a processing state after an unexpected server failure.

4\. Add comprehensive automated integration and end-to-end tests.

5\. Secure BillPort administrative endpoints with authentication and authorization.

6\. Improve frontend coverage and add more detailed operational monitoring.



\## 12. Technologies Used



\- Node.js

\- Express.js

\- MongoDB

\- Mongoose

\- JSON Web Tokens (JWT)

\- bcryptjs

\- Axios

\- HMAC-SHA256

\- Socket.IO

\- Postman

