import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, gte, isNull, lt, or, sql } from "drizzle-orm";
import { tasks } from "../db/schema.js";

/**
 * The PR watcher filters on an activity cutoff. Interpolating a bare `Date`
 * into a raw `sql` template compiles and typechecks fine, but postgres.js
 * cannot encode it — it throws "The 'string' argument must be of type string
 * ... Received an instance of Date" at runtime, which killed the whole watcher
 * cycle. Comparing through drizzle's operators lets the column's type map the
 * Date to a driver value.
 *
 * These tests assert on the compiled parameters, so they catch the encoding
 * mistake without needing a database.
 */
describe("PR watcher activity-cutoff predicates", () => {
  const dialect = new PgDialect();
  const cutoff = new Date("2026-08-01T00:00:00Z");

  const compile = (where: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(where);

  it("encodes the cutoff rather than passing a raw Date", () => {
    const { params } = compile(
      and(sql`${tasks.state} IN ('pr_opened', 'failed')`, gte(tasks.lastActivityAt, cutoff))!,
    );
    expect(params.length).toBeGreaterThan(0);
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });

  it("encodes the aged-out predicate too", () => {
    const { params } = compile(
      and(
        sql`${tasks.state} = 'pr_opened'`,
        or(isNull(tasks.lastActivityAt), lt(tasks.lastActivityAt, cutoff)),
      )!,
    );
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });

  it("demonstrates the mistake this guards against", () => {
    const { params } = compile(sql`${tasks.lastActivityAt} >= ${cutoff}`);
    // A bare Date survives into the driver here — the shape that broke prod.
    expect(params.some((p) => p instanceof Date)).toBe(true);
  });
});
