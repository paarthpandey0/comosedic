# Lumina Study — Security Specification (Phase 0)

## 1. Data Invariants
1. **User Isolation (Zero Cross-User Access)**: Every user profile (`/users/{userId}`) and study record (`/subjects`, `/resources`, `/notes`, `/flashcards`, `/quizzes`, `/tutorMessages`, `/studyPlanTasks`, `/studySessions`) is strictly owned by a single authenticated, email-verified user (`request.auth.uid`). No blanket reads or unauthenticated access exist.
2. **Relational Integrity**: No study resource, note, flashcard, quiz, tutor message, study plan task, or study session can be created under a `subjectId` that does not exist or is not owned by `request.auth.uid`.
3. **Immutable Ownership & Creation Timestamps**: `ownerId` and `createdAt` can never be modified after document creation; `updatedAt` must always equal `request.time`.
4. **Volumetric & Schema Enforcement**: Every string has bounded length (`size()`), every list is bounded (`size() <= MAX`), unknown/shadow fields are rejected via `hasAll` + `hasOnly` on create and `affectedKeys().hasOnly(...)` on update, and document IDs must match `^[a-zA-Z0-9_\-]+$`.
5. **Terminal Quiz State Locking**: Once a quiz reaches `status: "completed"`, its score, answers, results, and weak topics cannot be altered.

## 2. Dirty Dozen Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Shadow Field Injection on Subject Create**: `{ ownerId: uid, name: "Physics", ..., isAdmin: true }` -> Denied by `hasOnly(...)`.
2. **Identity Spoofing on Resource Create**: `{ ownerId: "other-uid", subjectId: mySubjectId, ... }` -> Denied by `data.ownerId == request.auth.uid`.
3. **Orphaned Note Creation (Foreign Subject)**: `{ ownerId: uid, subjectId: "someone-elses-subject", ... }` -> Denied by `get(.../subjects/...).data.ownerId == request.auth.uid`.
4. **Unverified Email Write Attempt**: Authenticated token with `email_verified: false` writing to `/subjects` -> Denied by `isVerified()`.
5. **ID Poisoning**: Document ID `"../../etc/passwd"` or 500-char ID on `create` -> Denied by `isValidId()`.
6. **Timestamp Spoofing**: `{ ..., createdAt: "2020-01-01T00:00:00Z" }` -> Denied by `createdAt == request.time`.
7. **Ownership Hijack on Update**: Updating a subject with `ownerId: "attacker-uid"` -> Denied by `incoming().ownerId == existing().ownerId`.
8. **Terminal State Bypass on Completed Quiz**: Updating `score: 100` after `existing().status == "completed"` -> Denied by terminal state lock.
9. **Blanket List Query Scraping**: Listing `/flashcards` without `where("ownerId", "==", uid)` -> Denied by `resource.data.ownerId == request.auth.uid`.
10. **PII Leak Attempt**: Reading `/users/{otherUid}` as a different signed-in user -> Denied by `request.auth.uid == userId`.
11. **Oversized Payload Denial-of-Wallet**: Creating a flashcard with 50KB `front` string -> Denied by `front.size() <= 2000`.
12. **Array Type Poisoning**: Creating a subject with `topics: [12345]` -> Denied by `arr[0] is string`.
