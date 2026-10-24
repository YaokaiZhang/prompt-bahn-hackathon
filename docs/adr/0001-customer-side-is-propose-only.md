# The agent only proposes contact with the customer side

The brief allows the agent to contact a customer once an operator approves. We went stricter: in v1 the agent never contacts the customer side (the paying customer, a contact the customer gave us, or a site the customer owns). It drafts a proposal with the script and evidence, and the operator makes the contact and records the answer on that proposal.

The reason is the data. Customers in the snapshot have no contact fields at all, and existing customer exchanges run through support conversations handled by people. An agent-run customer channel would have to be invented, so we left it out. Contacting the customer side is a planned later capability: a new policy row that changes "propose only" to "needs a yes", plus a channel to reach the customer.

## Amendment (2026-10-24): pickup-readiness calls

The brief asks for an agent that calls the seller or the pickup place to confirm the car is ready and the papers are there, works through phone menus, and tries again later if nobody answers. On some orders that pickup place is customer side: a site the customer owns (CD-420719), or a pickup contact the customer gave us (CD-420449, CD-421011, CD-421051). Leaving those out dropped calls the brief wants made, so the policy gains one row, `pickup-readiness`: a tier-1 pickup-readiness call (car ready, papers and keys there, who hands it over, callback if nobody answers) to the order's pickup place or pickup contact acts alone, even on the customer side.

Everything else stands. The paying customer is never called. Delivery-side customer contacts (for example Celia Hollowmere on CD-420437) and any other question for a customer-side contact stay propose only, and any change to the order learned on the call still needs a yes. The row is the engine's: the reviewer's prompt and policy rows are unchanged, so a reviewer finding addressed to a customer-side contact is still a propose-only proposal.
