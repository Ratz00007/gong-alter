declare module 'bun:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void
  export function it(name: string, fn: () => void | Promise<void>, timeout?: number): void
  export function beforeAll(fn: () => unknown): void
  export function afterAll(fn: () => unknown): void
  export function beforeEach(fn: () => unknown): void
  export function afterEach(fn: () => unknown): void

  export interface Matchers<T = unknown> {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toMatch(expected: RegExp | string): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeNull(): void
    toBeUndefined(): void
    toBeDefined(): void
    toBeGreaterThan(n: number | bigint): void
    toBeGreaterThanOrEqual(n: number | bigint): void
    toBeLessThan(n: number | bigint): void
    toBeLessThanOrEqual(n: number | bigint): void
    toBeCloseTo(n: number, digits?: number): void
    toThrow(expected?: RegExp | string): Promise<void> & void
    not: Matchers<T>
    resolves: Matchers<Awaited<T>>
    rejects: Matchers<unknown>
  }

  export function expect<T = unknown>(actual: T): Matchers<T>
}
