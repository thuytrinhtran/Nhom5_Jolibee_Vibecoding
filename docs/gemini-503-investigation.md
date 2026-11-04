# Gemini 503 investigation — ASUS, 2026-11-04

Scope: synthetic TV3 flow fixture only. No employee dataset, Supabase access,
database writes, environment-file changes or model switch. Four generateContent
requests total, each invoked once; no retry loop. A separate models-list GET
confirmed available model IDs without a generation request.

## Payload measurement

Captured the actual adapter request in memory using an injected transport;
recorded only counts, lengths and status codes, never payload text or credentials.

| Metric | Value |
| --- | ---: |
| Synthetic employees | 8 |
| Assignments | 8 |
| Registered employee/date/shift cells | 10 |
| Declared demand cells | 6 |
| Summary UTF-8 bytes | 5,025 |
| System prompt characters / UTF-8 bytes | 1,858 / 2,366 |
| Output schema bytes / object nodes | 713 / 18 |
| Full request UTF-8 bytes | 9,035 |

The summary retains coverage, shortages, experience, skills, valid availability,
assignments, weekly hours/configured limits, source completeness, test-rule labels
and missing criteria. Raw names, contact details, branch IDs and database mappings
do not cross the provider boundary. This is a small fixture, not a size audit of
the real employee dataset or proof that all larger schedules fit the 100 KB limit.

## Live observations

Model: `gemini-3.6-flash`; endpoint: Google v1beta generateContent.
Original JSON schema, system prompt and evaluation data were retained.

| Call | Request | Result |
| --- | --- | --- |
| 1 | Current adapter, maxOutputTokens=8192 | HTTP 200, STOP, complete report accepted by parseAIReport; NEEDS_ADJUSTMENT; 26,984 ms |
| 2 | Same request, only maxOutputTokens=1024 | HTTP 503, UNAVAILABLE, provider overload evidence; 5,758 ms |
| 3 | Full evaluatePreview path with injected synthetic repository | HTTP 503, UNAVAILABLE, provider overload; 5,539 ms; plan unchanged |
| 4 | Manually adjusted synthetic preview through the same service | HTTP 503, UNAVAILABLE, provider overload; 2,397 ms; plan unchanged |

Successful call usage: 2,346 prompt tokens, 407 output tokens and 1,687 thinking
tokens as reported by the provider. Lowering the total output budget to 1,024
cannot be assumed safe for this reasoning workload. The HTTP 503 response itself
does not establish that the smaller budget caused the failure.

## Conclusions and remaining acceptance

- A full schedule report has succeeded with the current request and schema.
- These results do not establish excessive payload size, a JSON bug or a quota
  failure. Three failures explicitly reported UNAVAILABLE/overload, not 429 or
  INVALID_ARGUMENT; none of those failed requests reached the client timeout.
- Do not truncate employees/availability or change prompt/schema/token budgets
  based on these observations. Such changes could lose scheduling evidence.
- Frontend complete-report rendering, automatic reevaluation and error handling
  are regression-tested offline. Live service-to-browser acceptance remains
  pending: the live service attempts did not receive a successful report.
- Proposed A/B candidate, subject to user approval: `gemini-3.5-flash-lite`.
  It is listed as supporting generateContent for the configured key and has
  documented structured-output support. Its availability and review quality
  still need testing; it is not an automatic fallback. Do not use
  `gemini-3.5-flash` as a presumed independent fallback: Google documents that
  this deprecated ID routes to gemini-3.6-flash.

References: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
and https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash .

## Approved Flash-Lite comparison — 2026-11-04

User authorized at most two generation calls to `gemini-3.5-flash-lite`, without
changing the default model. Exactly two were made through evaluatePreview with
the same original synthetic fixture, prompt, schema and maxOutputTokens=8192.
Both requests were checked to be 9,035 bytes, with a 1,858-character system prompt
and 5,025-byte summary. No truncation, schema change or automatic retry was used.

| Run | HTTP | Total evaluation time | Parsed report | Conclusion |
| --- | --- | ---: | --- | --- |
| 1 | 200 | 2,982 ms | Valid; service conclusion checks passed | NEEDS_ADJUSTMENT |
| 2 | 200 | 2,622 ms | Valid; service conclusion checks passed | NEEDS_ADJUSTMENT |

Success: 2/2; HTTP 503: 0/2. Mean successful latency: 2,802 ms.
Input: 2,346 tokens each; output: 326 and 321 tokens. Both reports had STOP finish
reason. Original plan and source revision were unchanged.

Quality was checked against Rule Engine output: 8 assignments for 9 required,
one missing position and one experience-shortage cell. Both reports identified
2026-11-02 / S002 / D003 and EXPERIENCE_SHORTAGE with one experienced worker
against a target of two, plus incomplete coverage. Both stayed advisory,
returned null assignment proposals and retained limitations concerning preference
rank, holidays and unapproved fairness thresholds. Neither explicitly summarized
the aggregate as "8/9, missing one worker"; their staffing diagnosis is useful
but less precise than the deterministic coverage display. No evidence from these
two reports establishes performance on a larger schedule or all business cases.

For the strict comparison, previous 3.6 calls 1 and 3 used this same initial
fixture/configuration: 1/2 successes, 1/2 HTTP 503, successful latency 26,984 ms.
The other previous calls changed the output budget or edited the plan and must
not be counted as identical-payload controls. Samples were taken at different
times, so the observed availability difference is not an SLA or a load-controlled
benchmark. Flash-Lite's successful latency was about 9.6 times shorter here.

Recommendation: propose Flash-Lite for the next synthetic web acceptance pass,
subject to separate approval before any default-model change. Keep Rule Engine
checks and authoritative coverage visible. No source, credentials or environment
file was changed for this comparison; default remains gemini-3.6-flash.
