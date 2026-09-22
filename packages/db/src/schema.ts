// No domain tables yet — users/organizations/projects/assets/assessments/findings/
// reports are added in a later batch once the domain model is implemented. Kept as a
// real module (rather than deleted) so drizzle-kit and the client wiring in client.ts
// have a stable import target that only needs to grow, not be created from scratch.
export {};
