# Membership setup (cash payment for members)

A member is someone with an active PayPal subscription. Members can pick
**Efectivo** when booking. Everyone else sees the option greyed out, which is
how it already looks today.

The backend is done. The sign-up screen isn't built yet. This guide covers the
PayPal and Vercel setup it needs.

---

## 1. Which PayPal ID goes where

PayPal shows you a lot of IDs. Three are already in Vercel from the PayPal
checkout, and **only one new kind goes in: the Plan ID**. The rest are for
reference, or the system handles them on its own.

| ID | Looks like | Where you see it | What to do with it |
|---|---|---|---|
| **Client ID** | long random text | developer.paypal.com → Apps & Credentials → your app | Already set as `PAYPAL_CLIENT_ID`. Nothing new. |
| **Secret** | long random text | same page, under the Client ID | Already set as `PAYPAL_CLIENT_SECRET`. Nothing new. |
| **Webhook ID** | short code, e.g. `8PT597110X687430LKGECATA` | your app → Webhooks | Already set as `PAYPAL_WEBHOOK_ID`. You only **add events** to it (step 4). |
| **Product ID** | `PROD-...` | Subscriptions → Products | **Don't copy it.** A product is only the folder that holds your plans. |
| **Plan ID** | `P-...` | Subscriptions → Plans (one per plan) | **Copy this.** It goes in `PAYPAL_MEMBERSHIP_PLAN_ID` (step 3). |
| **Subscription ID** | `I-...` | Subscriptions → Subscribers, one per customer | **Don't copy it.** The system saves one per member on its own. |
| **Merchant ID / Payer ID** | ~13 characters | account settings / each subscriber | Not used. |

Rule of thumb: **`P-` goes in Vercel. `PROD-` and `I-` never do.**

If you used PayPal's "subscribe button" generator, its code snippet contains
`client-id=...` (the Client ID you already have) and `plan_id: 'P-...'`. That
`P-...` value is the one you need.

### Sandbox and live are separate worlds

Every ID above exists twice: once in **sandbox** (test money) and once in
**live** (real money). A plan you create in sandbox **does not exist** in live,
and live rejects it, the same way it rejects anything else it doesn't know.
Create the plan in both and keep the values apart:

- Vercel **Production** gets the live values, with `PAYPAL_ENV=live`.
- Vercel **Preview** (and your local `.env`) gets the sandbox values, with
  `PAYPAL_ENV=sandbox`.

---

## 2. Create the membership plan(s) in PayPal

Do this in sandbox first (sandbox.paypal.com, logged in as your sandbox
*business* account), then repeat it in your real account.

1. In the PayPal business dashboard, open **Subscriptions**. Depending on the
   menu version it's under *Pay & get paid* or *Products & Services*.
2. **Create a product** first. Call it something like "Membresía Inercia",
   type *Service*. This gives a `PROD-...` ID, which you can ignore.
3. **Create a plan** under that product:
   - Pricing: a fixed price in **USD**. PayPal doesn't bill in lempiras.
   - Billing cycle: monthly, yearly, or whatever you're offering.
   - Leave setup fee and trial off unless you want them.
   - Turn the plan **on** (Active).
4. Copy the plan's **Plan ID** (`P-...`).

### Several plans (for example monthly and yearly)

Create one plan per option. **Each one gets its own `P-...` ID**, and that's
fine. They all go in the same variable, separated by commas:

```
PAYPAL_MEMBERSHIP_PLAN_ID=P-MONTHLY1234567890,P-YEARLY0987654321
```

- Every plan in the list counts as a membership. Being subscribed to any of
  them unlocks cash.
- The **first** one is the default when the sign-up screen doesn't say which
  plan to use. The future screen can offer all of them.
- An ID that isn't in the list is rejected, even if it's a real PayPal plan.

### Changing the price later

PayPal plans don't really change price. You make a new plan instead:

1. Create the new plan and copy its `P-...`.
2. Put it **first** in the list and **keep the old one** after it:
   `P-NEWPRICE...,P-OLDPRICE...`
3. Turn the old plan off in PayPal so nobody new joins it.

If you delete the old ID from the list, its current subscribers stop counting
as members.

---

## 3. Add the variables in Vercel

Vercel → the main site's project (inerciahn.com, not the admin one) →
**Settings → Environment Variables**:

| Variable | Production | Preview |
|---|---|---|
| `PAYPAL_MEMBERSHIP_PLAN_ID` | live `P-...` ID(s) | sandbox `P-...` ID(s) |
| `SITE_URL` | `https://inerciahn.com` | your preview URL, or leave empty |

`SITE_URL` is only used to send buyers back to the site after they approve on
PayPal's page. With it empty, sign-up still works through the PayPal popup
buttons.

Variables only take effect on the **next deployment**. Redeploy after saving.

---

## 4. Add the subscription events to the webhook

developer.paypal.com → Apps & Credentials → your app (do it for both the
sandbox app and the live app) → **Webhooks** → edit the existing webhook, the
one that points at `https://inerciahn.com/api/paypal/webhook`. Don't create a
second one: its ID wouldn't match `PAYPAL_WEBHOOK_ID`.

Tick these events and keep the ones already there:

- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.UPDATED`
- `BILLING.SUBSCRIPTION.RE-ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
- `PAYMENT.SALE.COMPLETED` (this is the monthly or yearly renewal charge)

These keep memberships up to date when someone renews, cancels, or has a
payment fail.

---

## 5. Check that it's live

Until the sign-up screen exists, the quick check is:

```
curl -i https://inerciahn.com/api/subscription/status
```

- **401** means it's deployed. It's asking for a login, which is correct.
- **404** means the backend isn't deployed yet.

Logged-in customers get `"active": false` until they subscribe, so the booking
page looks the same as today.

---

## How it behaves

- **Subscribed and paying:** cash is available.
- **Cancels:** cash stays available until the end of the period they already
  paid for, then turns off.
- **Payment fails and PayPal suspends the subscription:** cash turns off right
  away, and turns back on if they fix the payment.
- **Cash booking:** the server checks the membership itself. Someone can't
  unlock cash by tampering with the page. The booking is saved as
  *pending* with no transfer proof needed, and it records which subscription
  allowed it.

Memberships are stored in the Firestore collection `memberships`, one document
per user. Only the server reads and writes it, so **no Firestore rules change
is needed**.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| "La membresía todavía no está disponible." | `PAYPAL_MEMBERSHIP_PLAN_ID` isn't set in this environment, or no redeploy since setting it. |
| "Esta suscripción no es la membresía de Inercia." | The plan isn't in the list, or it's a sandbox plan on live (or the reverse). |
| "Ese plan de membresía no existe." | The sign-up screen asked for a `P-...` that isn't in the list. |
| Webhook shows 401 in PayPal's delivery log | `PAYPAL_WEBHOOK_ID` doesn't match the webhook you edited. |
| Someone paid but still isn't a member | Check the webhook events in step 4, then PayPal's webhook delivery log for errors. |

Code: `api/_lib/membership.js` (rules), `api/subscription/*.js` (endpoints),
`api/paypal/webhook.js` (events).
