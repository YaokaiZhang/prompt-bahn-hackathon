# The agent publishes checked-normal orders; call results wait for the operator before publishing

An order that is not on the driver market yet (New orders, Ready to post) is published by the agent on its own once it is Normal and the reviewer has read it. An order not published yet whose open points the agent's calls settled is Solved: the agent never publishes it. The operator sees each call result as a rewrite (what the records said, what the call says now) with the call's transcript, and the operator's approval confirms the changes and publishes the order.

We chose this because publishing a checked order is routine and reversible in practice, while a call result is what a third party said on the phone: it rewrites what the records say, and a job built on it should not reach drivers until a person has read it. Requiring a yes on every publish would put most of the board back in front of the operator; publishing Solved orders alone would let an unread call result go out to drivers. "Normal on the rules alone" is not enough either: without the reviewer's read (no model key) the agent does not publish, and the operator can publish by hand.

Publications are kept as their own append-only events, not effect events (ADR 0002): publishing changes the order's stage, not its records, so it must not re-review the order. A demanding job on the market (cross-country, more than 12 hours of driving, or a ferry or train between the endpoints) reaches drivers only with a travel plan, which is a suggestion and books nothing.

Only orders not published yet can be Solved. Once an order is on the market or on the road, the agent's call results are committed as they are (ADR 0001) and need no approval, so orders not published yet and orders on the road stay apart.
