# Lab 11 — Events, replay, and refunds

## Milestone 1 — What belongs on the bus?

| Operation | As wired today | Design choice | Why |
|---|---|---|---|
| Check room conflicts | Direct call to `conflictingBooking` in `book` | Keep in request | Two organizers cannot both hold the same room for overlapping slots. |
| Save the booking | Direct call to `store.save` in `book` | Keep in request | Returning a confirmation promises the room is held. |
| Update the search index | Direct call to `indexBooking` in `book` | Subscribe to `booking.confirmed` | A stale room-finder result can be repaired after search recovers. |
| Send the confirmation email | `EmailConfirmationHandler` subscribes to `booking.confirmed` | Keep subscriber | A mail outage can delay the receipt of a confirmation while the room remains held. |
| Pay a refund | `RefundLedger` subscribes to `refund.requested` | Keep subscriber | Cancellation can release the room while the payment provider recovers. |

**Search indexing and incident RES-5108.** At `src/service/bookingService.ts:94`, `BookingService.book` calls `this.searchIndex.indexBooking(booking, room, now)`. If search is down, the caller gets a thrown `SearchIndexUnavailableError`. Execution stops before the save on line 95 and before the confirmation event. This explains why both the kiosk and website failed during maintenance. Indexing the saved booking from a confirmation subscriber would let the caller receive the booking even if indexing throws. The bus records the failed delivery for later recovery, during which room-finder results may be stale.

**Conflict detection.** The organizer needs a reliable answer about the requested time before committing to the room. The service checks existing bookings before saving. A clash raises a `BookingError`, leaving the earlier reservation intact. Deferring this check could confirm two overlapping reservations and leave the front desk to revoke one later. Even if search is stale, checking the booking store still protects this decision.

## Milestone 2 — A repeated refund

**Prediction recorded before running the demo.** Each delivery of the same refund message will append another ledger entry and settle the same amount again. After two replays there will be three entries and three payments. The bus will retain one refund message with the original ID and count three deliveries.

### Original replay

```text

> campus-reservations@1.0.0 demo:replay
> tsx src/demos/replayDemo.ts

booked bk-1001 for 8500 cents
cancelled bk-1001, refund 8500 cents, refund message msg-3

=== after the cancellation (one delivery of the refund message) ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 1
gateway settlements: 1
  stl-1 bk-1001 $85.00
money returned in total: $85.00
dead letters: 0

redelivering msg-3

=== after one redelivery ===
ledger entries: 2
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
  led-2 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 2
gateway settlements: 2
  stl-1 bk-1001 $85.00
  stl-2 bk-1001 $85.00
money returned in total: $170.00
dead letters: 0

redelivering msg-3 again

=== after two redeliveries ===
ledger entries: 3
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
  led-2 bk-1001 $85.00 (cancelled more than two hours ahead)
  led-3 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 3
gateway settlements: 3
  stl-1 bk-1001 $85.00
  stl-2 bk-1001 $85.00
  stl-3 bk-1001 $85.00
money returned in total: $255.00
dead letters: 0

=== bus log ===
  msg-1 booking.confirmed deliveries=1
  msg-2 booking.cancelled deliveries=1
  msg-3 refund.requested deliveries=3
```

The prediction matched: one refund for 8,500 cents produced one, two, then three settlements. The organizer received 25,500 cents in total. Only one refund message appeared in the log.

### Handler change

```diff
diff --git a/src/handlers/refundLedger.ts b/src/handlers/refundLedger.ts
index 600ffca..ef320c2 100644
--- a/src/handlers/refundLedger.ts
+++ b/src/handlers/refundLedger.ts
@@ -24,6 +24,8 @@ export class RefundLedger implements Subscriber<RefundRequested> {
   readonly name = 'RefundLedger';
 
   private readonly entries: LedgerEntry[] = [];
+  private readonly recordedMessages = new Set<string>();
+  private readonly settledMessages = new Set<string>();
   private readonly gateway: PaymentGateway;
 
   constructor(gateway: PaymentGateway) {
@@ -32,15 +34,22 @@ export class RefundLedger implements Subscriber<RefundRequested> {
 
   handle(message: Message<RefundRequested>): void {
     const event = message.payload;
-    this.entries.push({
-      entryId: `led-${this.entries.length + 1}`,
-      bookingId: event.bookingId,
-      organizer: event.organizer,
-      amountCents: event.amountCents,
-      reason: event.reason,
-      recordedAtMinute: message.publishedAtMinute,
-    });
-    this.gateway.refund(event.bookingId, event.amountCents);
+    if (!this.recordedMessages.has(message.id)) {
+      this.entries.push({
+        entryId: `led-${this.entries.length + 1}`,
+        bookingId: event.bookingId,
+        organizer: event.organizer,
+        amountCents: event.amountCents,
+        reason: event.reason,
+        recordedAtMinute: message.publishedAtMinute,
+      });
+      this.recordedMessages.add(message.id);
+    }
+
+    if (!this.settledMessages.has(message.id)) {
+      this.gateway.refund(event.bookingId, event.amountCents);
+      this.settledMessages.add(message.id);
+    }
   }
 
   /** Every ledger entry, oldest first. */
```

The handler remembers the message ID separately after each successful step. A replay can finish an outstanding payment while preserving the existing ledger entry. This covers repeated delivery of one ID in this running process. A new ID for the same business refund, loss of in-memory state, or a provider that settles before reporting an error would require additional protection.

### Fixed replay

```text

> campus-reservations@1.0.0 demo:replay
> tsx src/demos/replayDemo.ts

booked bk-1001 for 8500 cents
cancelled bk-1001, refund 8500 cents, refund message msg-3

=== after the cancellation (one delivery of the refund message) ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 1
gateway settlements: 1
  stl-1 bk-1001 $85.00
money returned in total: $85.00
dead letters: 0

redelivering msg-3

=== after one redelivery ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 1
gateway settlements: 1
  stl-1 bk-1001 $85.00
money returned in total: $85.00
dead letters: 0

redelivering msg-3 again

=== after two redeliveries ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 1
gateway settlements: 1
  stl-1 bk-1001 $85.00
money returned in total: $85.00
dead letters: 0

=== bus log ===
  msg-1 booking.confirmed deliveries=1
  msg-2 booking.cancelled deliveries=1
  msg-3 refund.requested deliveries=3
```

Across cancellation and both replays, the ledger contains the same single 8,500-cent entry, the gateway receives one call, and the organizer receives one 8,500-cent settlement. The bus counts all three deliveries of msg-3.

## Milestone 3 — Recover the unfinished payment

The first delivery recorded 8,500 cents owed and the cancellation returned successfully. The provider threw before settlement. With zero cents returned, the organizer was still owed the full refund.

**Recovery choice.** Redeliver the original refund message after the one-shot provider failure. The handler can reuse the recorded ledger entry and retry the outstanding payment. The output below captures both sides of that recovery.

```text

> campus-reservations@1.0.0 demo:failure
> tsx src/demos/failureDemo.ts

armed: call 1 to the payment provider will throw
booked bk-1001 for 8500 cents
cancelled bk-1001, refund 8500 cents, refund message msg-3
the cancel call itself returned: booking is cancelled

=== after the failed delivery ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 1
gateway settlements: 0
money returned in total: $0.00
dead letters: 1
  msg-3 refund.requested attempt 1 in RefundLedger: payment provider did not answer on call 1 for bk-1001
    failedAtMinute: 480
    payload: {"bookingId":"bk-1001","organizer":"H. Ahmad","organizerEmail":"hahmad@example.edu","amountCents":8500,"reason":"cancelled more than two hours ahead","requestedAtMinute":480}

=== bus log ===
  msg-1 booking.confirmed deliveries=1
  msg-2 booking.cancelled deliveries=1
  msg-3 refund.requested deliveries=1

=== after redelivery ===
ledger entries: 1
  led-1 bk-1001 $85.00 (cancelled more than two hours ahead)
gateway calls: 2
gateway settlements: 1
  stl-1 bk-1001 $85.00
money returned in total: $85.00
dead letters: 1
  msg-3 refund.requested attempt 1 in RefundLedger: payment provider did not answer on call 1 for bk-1001
    failedAtMinute: 480
    payload: {"bookingId":"bk-1001","organizer":"H. Ahmad","organizerEmail":"hahmad@example.edu","amountCents":8500,"reason":"cancelled more than two hours ahead","requestedAtMinute":480}

=== bus log ===
  msg-1 booking.confirmed deliveries=1
  msg-2 booking.cancelled deliveries=1
  msg-3 refund.requested deliveries=2
```

The final log line shows `msg-3 refund.requested deliveries=2`. Two gateway calls yielded one settlement; the ledger still contains only led-1. The dead letter records the first failed attempt and remains available as history after recovery.

**Cost of manual triage.** An operator would have to match the booking and refund amount to the provider’s settlement history, confirm that payment is still owed, and arrange one payout. The organizer would wait for that review; issuing payment safely requires an authoritative settlement check.
