# Design a New Service

Sketch {{service_name}} before I write any of it. Do not give me code yet.

Answer these four, in order:

- What data does it own outright, and what does it have to ask someone else for?
- What calls does it expose, and who calls them?
- What does it depend on, and what happens to us when each of those is slow or down?
- Where does state live between requests?

Then give me the simplest version that works at {{expected_load}}, even if it is one process and one
table. After that, tell me which part breaks first when the load goes up 10x, and what I would have to
change. I would rather rewrite a small thing later than build the big one now.

If two designs are close, say which you would pick and why.
