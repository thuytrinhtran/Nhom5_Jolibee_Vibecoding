# TV4 shortage review: partial implementation, pending TV3/TV1 coordination

Confirmed requirement: a valid schedule at, below OR above staffing demand may
be submitted by QL and approved or rejected by GS. All staffing deviations are
warnings, never automatic decisions. The former overstaff-only rejection
proposal is superseded by this requirement.
Configuration gates remain independent and must not be enabled by this change.

Implemented only in TV4 read-only review: move STAFFING_SHORTAGE/STAFFING_EXCESS
issues to warnings and derive missing warnings from cell totals. Retain the
original coverage_complete and all counts. Other issues still
block readiness. TV4 review can_submit describes business eligibility only;
the editor uses a different approval-handoff response, still unchanged.

## Proposed shared service patch (not applied)

Owner: TV3/shared. backend/src/services/schedule-review.service.ts:

- Around lines 54-55, keep computing coverageComplete. Store STAFFING_SHORTAGE
  in warnings instead of issues; retain the total and per-cell missing_count.
- Around line 61, remove only `&&coverageComplete` from can_submit.
  Keep hard constraints, data completeness, input freshness, eligible status
  and CLOSED period. Preserve valid assignment checks and metadata checks.
- Around line 62, merge staffing warnings with experience/summary warnings.
- Add STAFFING_EXCESS warnings from coverage.excess_count, independently of
  shortage warnings. A week may have both shortage cells and excess cells.
  Do not offset one cell against another or alter required_count.
- prepareApprovalHandoff must use that validated result for its payload;
  do not fabricate a payload client-side or override delivery.configured.
- Update shared tests tv3-handoff.test.cjs, schedule-ai.test.cjs and
  tv3-journey.test.cjs for the new handoff policy. Do not redefine AI's
  suitability conclusion or coverage_complete merely to allow submission.

Owner: TV3/editor. frontend/src/pages/manager/ScheduleReviewPanel.tsx:

- Keep the disabled expression and guards; consume corrected server can_submit.
- Render shortage counts as warnings, separately from data/period errors.
- Explain delivery.configured=false as a separate gate, not a staffing failure.
- Correct the unconditional rejected-schedule explanation for configured DRAFTs.
- Test valid understaffed handoff with configured=true/false independently,
  and valid overstaffed handoff, plus bad assignments, stale inputs and period
  not CLOSED. Update the coverage label: coverage_complete alone cannot
  distinguish equal/excess counts. Render assigned/required/missing/excess.

Owner: TV3/shared engine. backend/src/services/scheduling.engine.ts:294:
The single DEMAND_EXCEEDED condition combines missing demand and excess staff.
Proposed split in reviewAssignments (not applied):

```ts
const need=input.requirements.find(r=>r.work_date===assignment.work_date&&r.shift_id===assignment.shift_id&&r.department_id===assignment.department_id);
if(!need)throw new ScheduleError(422,'DEMAND_NOT_FOUND','Phân công không có ô nhu cầu hợp lệ.');
// No count-based rejection here. Keep all employee/registration/overlap checks.
```

Preserve duplicate detection, date/shift/department matching, assignmentIssue,
skills, hours, active employee and branch checks. In buildScheduleResult around
line 260 add STAFFING_EXCESS to warnings when rows.length>r.required_count.
Do NOT catch/ignore DEMAND_EXCEEDED in TV4: current code uses it for invalid cells.
Keep generator capacity targets; changing manual review policy does not require
the automatic scheduler to deliberately overstaff.

Owner: shared UI. frontend/src/components/Toast.tsx COVERAGE_INCOMPLETE guidance
must be reviewed after the RPC change: do not tell QL all shortages must be filled
as a prerequisite to submitting under the newly confirmed rule.

## Proposed database patch (not applied)

Owner: TV1/database. Do not edit an applied migration.
Concrete proposal: docs/proposals/tv4-staffing-warning-migration.sql.
It replaces tv4_assert_schedule_v2 from the repository baseline, removing ONLY
the coverage count equality IF block at lines 58-61 of the applied TV4 migration.
No less-than or greater-than replacement is valid under the confirmed rule.
It is outside the migration runner path and has NOT been applied or SQL-runtime
tested. Owner must compare the deployed definition/ACL before approving it.
Preserve all identity,
registration validity, assignment source/status, branch, period, version,
duplicate, locking, idempotency and transaction checks. The assertion is used
by SUBMIT, APPROVED and PUBLISH; assess all three and trigger dependencies.
Update workflow-v2-lifecycle.test.cjs for below/above demand on submit and GS
decisions, preserving assignment errors and concurrency tests. Since the same
assertion is used by PUBLISH, explicitly review that action with TV1 too.

Additional TV3 database blockers (proposals only; do not edit old migrations):
- 20261101_tv3_rule_contract_v2.sql:127-128, tv3_result_v2 rejects any excess_count.
  A new migration must remove that count-only rejection and retain result stats;
  add STAFFING_EXCESS to per-cell warnings.
- The same file:358-359, persist_schedule_draft rejects count>required_count.
  Remove only that count cap in a new reviewed definition, preserving source,
  identity, registration, assignment validity, version and transaction guards.
- 20261031_tv3_schedule_draft.sql:194-195 is the older allocator definition;
  verify the deployed catalog uses the newer definition before migration.
These are draft save/result blockers, distinct from TV4's submit RPC blocker.

Before release, use isolated PostgreSQL tests to prove:
valid shortage -> SUBMIT -> PENDING_APPROVAL only; GS may approve or reject;
wrong role/branch, stale version, invalid assignments still fail; concurrent
requests remain safe; failures roll back audit and status atomically.
No such database behavior is claimed by the stub-based review tests.

## Remaining gates

Editor handoff still returns can_submit=false for a shortage; shared engine
still rejects overstaffed manual review. The unchanged RPC still raises
COVERAGE_INCOMPLETE on either staffing deviation. Therefore this branch is NOT
an end-to-end fix. It must not be presented as enabling the submit button yet.
Runtime workflow configuration also needs authorized verification independently.
The response-envelope fix in PR #10 is a separate dependency not included in
the integration base used for this branch.
