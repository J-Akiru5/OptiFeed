// Vitest stand-in for the `server-only` package.
//
// The real package throws when a module is imported outside a React Server
// Component bundle, which is exactly what we want in a client build. Tests
// import server actions directly in a jsdom environment, so the alias in
// vitest.config.ts points here instead. Next's own build does not use this
// file and keeps the real guard.
export {};
