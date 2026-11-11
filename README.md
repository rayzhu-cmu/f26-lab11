# Campus Reservations

The service behind the room booking page. People hold a room for a slot, get a
confirmation and a receipt, get reminded before it starts, and cancel with a
refund. TypeScript, Node 20, vitest. About 1,400 lines of source and a green
suite.

Side effects of a booking run through an in-memory message bus. The bus is
about 90 lines of code in `src/bus/inMemoryBus.ts`. It delivers synchronously
on the calling thread. Its doc comment states what it promises a subscriber. Read that comment first.

Times are minutes from midnight, so 540 is 09:00. Ranges are half-open,
`[start, end)`, so a booking ending at 600 and one starting at 600 sit back to
back without colliding. Money is in whole cents.

## Build and test

```
npm install
npm test
npm run typecheck
```

Everything should be green before you change anything. If it is not, see `SETUP.md`.

## The two demos

The demos are not part of the suite and CI does not run them. Start them by
hand:

```
npm run demo:replay
npm run demo:failure
```

`demo:replay` books a room, cancels it, and hands the refund message to the bus
again. `demo:failure` arms the payment provider to fail on its next call and
then cancels a booking that owes a refund. Both print the ledger, the payment
provider, the dead-letter list, and the bus log, so their output is what you
paste into `EVENTS.md`. Both print the same output on every run.

## Code map

- `src/domain/`: `types.ts`, `booking.ts` (ranges and formatting), `validation.ts`.
- `src/store/`: `bookingStore.ts` (the interface), `inMemoryBookingStore.ts`,
  `roomRegistry.ts`.
- `src/service/`: `bookingService.ts` (the API the page calls), `pricing.ts`,
  `availability.ts`.
- `src/bus/`: `inMemoryBus.ts` (publish, subscribe, redeliver, dead letters),
  `events.ts` (the event types and their payloads).
- `src/handlers/`: `emailConfirmationHandler.ts`, `receiptGenerator.ts`,
  `reminderScheduler.ts`, `statsUpdater.ts`, `refundLedger.ts`.
- `src/integrations/`: `searchIndexClient.ts`, `paymentGateway.ts`,
  `mailer.ts`, `templates.ts`.
- `src/audit/auditTrail.ts`, `src/ops/cleanupSweep.ts`,
  `src/reports/usageReport.ts`.
- `src/app.ts`: builds one running copy of the service and registers every
  subscriber. Registration order is delivery order and is written out there.
- `src/demos/`: the two runnable demonstrations.
- `tests/`: the suite.

## Other files here

- `TICKET.md`: an incident report from the operations team.
- `EVENTS.md`: where your answers go.
- `SETUP.md`: toolchain and first build.

See the Lab 11 handout on the course page for the three milestones you show a
TA.

AI assistance: OpenAI Codex (GPT-6) helped with the design choices, prediction, implementation, and verification.
