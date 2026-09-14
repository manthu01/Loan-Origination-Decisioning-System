/** Shared by KYC (deriving age from a live submission), the policy simulator, and
 * replay (both reconstructing a rule-evaluation context from stored data) -- age is
 * always derived server-side from DOB, never trusted as a client-supplied value. */
export function deriveAge(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    asOf.getMonth() > dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
