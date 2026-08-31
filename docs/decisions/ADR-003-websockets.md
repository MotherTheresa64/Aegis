# ADR-003: WebSockets for incident collaboration

**Status:** Accepted

Aegis uses WebSockets for bidirectional realtime incident and organization updates. The protocol supports future presence, acknowledgements, typing/activity indicators, and command messages that would be awkward over one-way SSE.
