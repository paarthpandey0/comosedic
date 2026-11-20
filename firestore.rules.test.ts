/**
 * Phase 0 Security Rules Verification Specification (Dirty Dozen Test Matrix)
 * Designed for @firebase/rules-unit-testing against firestore.rules.
 */

export interface SecurityTestCase {
  id: string;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expected: 'PERMISSION_DENIED';
  description: string;
}

export const DIRTY_DOZEN_CASES: SecurityTestCase[] = [
  {
    id: 'DD-01',
    name: 'Shadow Field Injection',
    collection: 'subjects',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Payload includes unauthorized shadow field isAdmin: true.'
  },
  {
    id: 'DD-02',
    name: 'Identity Spoofing',
    collection: 'resources',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Payload sets ownerId to a different user UID.'
  },
  {
    id: 'DD-03',
    name: 'Orphaned Child Record',
    collection: 'notes',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Payload references a non-existent or foreign subjectId.'
  },
  {
    id: 'DD-04',
    name: 'Email Unverified Spoof',
    collection: 'subjects',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Token has email_verified: false.'
  },
  {
    id: 'DD-05',
    name: 'ID Poisoning',
    collection: 'flashcards',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Document ID contains invalid characters or exceeds 128 bytes.'
  },
  {
    id: 'DD-06',
    name: 'Client Timestamp Spoofing',
    collection: 'studySessions',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'createdAt does not match request.time.'
  },
  {
    id: 'DD-07',
    name: 'Ownership Mutation on Update',
    collection: 'subjects',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Update attempts to reassign ownerId or mutate createdAt.'
  },
  {
    id: 'DD-08',
    name: 'Completed Quiz Mutation',
    collection: 'quizzes',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Update attempts to change score after status is completed.'
  },
  {
    id: 'DD-09',
    name: 'Unfiltered Collection List',
    collection: 'flashcards',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    description: 'List query lacks ownerId == auth.uid constraint.'
  },
  {
    id: 'DD-10',
    name: 'Cross-User PII Read',
    collection: 'users',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    description: 'User B attempts to read User A profile containing email.'
  },
  {
    id: 'DD-11',
    name: 'Value Length Exhaustion',
    collection: 'flashcards',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Flashcard front exceeds 2000 characters.'
  },
  {
    id: 'DD-12',
    name: 'Array Element Type Poisoning',
    collection: 'subjects',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'topics array contains a non-string element at index 0.'
  }
];
