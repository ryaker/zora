# WASM Sandbox Feasibility Spike

## Summary

This document captures the results of a feasibility spike into using WebAssembly (WASM) sandboxing for Zora's tool execution layer. The goal is to isolate each tool invocation in a memory-safe sandbox, preventing any single tool from accessing resources beyond its explicit capability grants.

## Approach

We evaluated two leading WASM runtimes for Node.js integration: **Wasmtime** and **Wasmer**. Both support the WASI (WebAssembly System Interface) standard, which defines capability-based access to filesystem, networking, and environment resources.

## Key Findings

**Wasmtime** is the recommended runtime. It offers the most mature WASI preview2 support and has first-class Node.js bindings. The **IronClaw pattern** -- where each tool runs in its own WASM instance with explicitly declared imports -- maps directly to Zora's architecture.

Zora's existing `WorkerCapabilityToken` interface already models the required capability grants (`allowedPaths`, `allowedCommands`, `allowedTools`). These tokens can be translated into WASI capability sets without any interface changes, providing a clean v1-to-v2 migration path.

## Migration Path

1. **v1 (current)**: Tools run as native Node.js with policy-based restrictions
2. **v1.5 (bridge)**: Compile `shell_exec` and `web_fetch` to WASM via AssemblyScript as proof of concept
3. **v2 (target)**: All tools run in WASM sandboxes; `WorkerCapabilityToken` maps directly to WASI imports

## Known Blockers

- WASM cold-start latency (~50-100ms per invocation) may need mitigation via instance pooling
- Not all Node.js APIs are available in WASI; a compatibility shim layer is required for tools that depend on `node:child_process` or `node:net`
- Compiled WASM binaries add ~2-5MB per tool, increasing the distribution size

## Recommendation

Proceed with a targeted proof-of-concept using Wasmtime for `shell_exec` sandboxing. This validates the IronClaw pattern with Zora's existing capability model before committing to a full v2 migration.
