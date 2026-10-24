# The agent only proposes contact with the customer side

The brief allows the agent to contact a customer once an operator approves. We went stricter: in v1 the agent never contacts the customer side (the paying customer, a contact the customer gave us, or a site the customer owns). It drafts a proposal with the script and evidence, and the operator makes the contact and records the answer on that proposal.

The reason is the data. Customers in the snapshot have no contact fields at all, and existing customer exchanges run through support conversations handled by people. An agent-run customer channel would have to be invented, so we left it out. Contacting the customer side is a planned later capability: a new policy row that changes "propose only" to "needs a yes", plus a channel to reach the customer.
