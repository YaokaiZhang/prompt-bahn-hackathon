# 02: Persona login

**What to build:** A person opening the app picks a persona (Operator, Site or Driver) with no password. The choice is kept in a cookie and shown in the shell header, where it can be switched. Operator lands on the order queue; Site and Driver land on a placeholder phone page that later tickets fill in. "Customer" is not a persona. Real access control is out of scope: the demo site sits behind basic auth.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] With no persona chosen, every page sends the person to the picker
- [ ] Choosing Operator opens the queue; choosing Site or Driver opens the phone page placeholder
- [ ] The current persona shows in the shell and can be switched without logging out
- [ ] Site and Driver cannot reach the operator's pages
- [ ] The picker and placeholder follow DESIGN.md and the existing shell
