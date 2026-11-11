import { describe, expect, it } from 'vitest';
import { BOOKING_CONFIRMED } from '../src/bus/events';
import { aRequest, newApp } from './fixtures';

/**
 * The example this file is built around, and the optional property that
 * generalises it.
 *
 * The example below is an ordinary test and runs with the rest of the suite.
 * The property under it is optional work for milestone 2. It is commented out
 * because it is written against a handler you have not changed yet. `fast-check`
 * is already in `package.json`, so uncommenting is all it takes to run it.
 * Start the uncomment at the `import fc` line and leave the paragraph above it
 * commented: it is prose, not code.
 */
describe('delivering the same message more than once', () => {
  it('leaves the dashboard numbers where they were, whichever message comes again', () => {
    const app = newApp();
    app.service.book(aRequest({ start: 540, end: 660 }));
    app.service.book(aRequest({ start: 11 * 60, end: 12 * 60 }));
    const [older, newer] = app.bus.messagesOfType(BOOKING_CONFIRMED);
    const afterBothBookings = app.stats.current();

    app.bus.redeliver(newer.id);
    app.bus.redeliver(older.id);
    app.bus.redeliver(older.id);

    expect(app.stats.current()).toEqual(afterBothBookings);
    expect(app.bus.deliveryCount(older.id)).toBe(3);
    expect(app.bus.deliveryCount(newer.id)).toBe(2);
  });
});

// Optional, milestone 2. Uncomment once your refund handler is finished.
//
// The property: whatever schedule of deliveries the bus produces, what the
// ledger says and what the payment provider settled depend only on which
// refund messages exist, not on how many times each one was delivered.
//
import fc from 'fast-check';
import { REFUND_REQUESTED } from '../src/bus/events';

describe('optional property: replay schedules', () => {
  it('leaves the refund state where one delivery each would leave it', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 12 }), (schedule) => {
        const app = newApp();
        const bookings = [
          app.service.book(aRequest({ start: 11 * 60, end: 13 * 60 })),
          app.service.book(aRequest({ start: 13 * 60, end: 15 * 60 })),
          app.service.book(aRequest({ start: 15 * 60, end: 17 * 60 })),
        ];
        for (const booking of bookings) {
          app.service.cancel(booking.id);
        }
        const refunds = app.bus.messagesOfType(REFUND_REQUESTED);
        const owed = refunds.length * bookings[0].priceCents;

        for (const index of schedule) {
          app.bus.redeliver(refunds[index].id);
        }

        expect(app.ledger.totalRefundedCents()).toBe(owed);
        expect(app.gateway.totalSettledCents()).toBe(owed);
      }),
      { numRuns: 100 },
    );
  });
});
