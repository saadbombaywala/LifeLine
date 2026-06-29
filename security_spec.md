# Security Specification - Lifeline

## 1. Data Invariants
- An authenticated user can only access, view, or modify their own sub-collections (`tasks`, `planLogs`) and their own profile document (`/users/{userId}`).
- A task's `userId` must equal the authenticated user's `uid`.
- A planLog's `userId` must equal the authenticated user's `uid`.
- `createdAt` is immutable.
- A user cannot change their own `uid` or `email` after creation.
- Enums are strictly enforced for status ("todo", "in_progress", "done", "missed") and source ("manual", "voice", "photo").

## 2. The Dirty Dozen Payloads (Negative Test Payloads)
1. **Malicious ID injection in User Profile**: Setting another user's email or UID during custom write.
2. **Accessing another user's tasks**: Reading `/users/attackerId/tasks/...` when logged in as "victimId".
3. **Impersonated Task Creation**: Creating a task with `userId` set to a victim's ID under the victim's subcollection but authenticated as the attacker.
4. **Invalid Task Status**: Creating a task with `status` set to "completed_by_hack".
5. **Invalid Task Source**: Specifying `source` as "injection_api".
6. **Mutating createdAt field**: Attempting to update `createdAt` of a task to reset historic records.
7. **Bypassing validation with extra fields**: Adding property `attackerControlledAdminState: true` inside user's own task sheet.
8. **Resource exhaustion / Denial of Wallet ID**: Large strings (>512 chars) as task ID or collection indices.
9. **Spamming PlanLogs**: Creating a log with an arbitrary future timestamp or spoofed actor ID.
10. **Admin escalation**: Writing an admin flag or setting specific role attributes on the user profile to bypass restrictions.
11. **Blanket listing bypass**: Attempting a collectionGroup query or global read across user tasks without specific `userId` limits.
12. **Status bypass on terminal records**: Attempting to update or reverse a task status after it was already completed or missed (terminal locking).

## 3. Threat Matrix & Rules Verification
All malicious attempts above will yield `PERMISSION_DENIED` thanks to the strict security rules in `firestore.rules`.
