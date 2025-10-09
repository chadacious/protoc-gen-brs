# protoc-gen-brs

Prototype workspace for generating BrightScript encode/decode modules from Protocol Buffers definitions. The current slice already:

- Parses `.proto` files (starting with `proto/simple.proto`).
- Emits BrightScript runtime helpers and message-specific encoders/decoders (currently supporting `string`, `int32`, `int64`, `bool`, and `bytes`) into `roku-app/source/generated/`.
- Produces JavaScript baseline vectors (JSON + BrightScript data) using `protobufjs` for parity checks.
- Loads the generated code and baseline data inside a Roku harness (`roku-app/source/main.brs`) to compare results.

The longer-term goal is to:

- Translate `.proto` schemas into BrighterScript modules that can run on Roku devices.
- Produce canonical baseline data using `protobufjs` so generated BrightScript logic can be verified.
- Execute those fixtures inside a Roku test harness to confirm parity with the JavaScript baseline.

## Prerequisites

- Node.js 18+ (the toolchain relies on ESM compatible features and async/await).
- Roku SDK tooling if you intend to side-load and run the bundled Roku app.

Install dependencies after cloning:

```bash
npm install
```

## Commands

- `npm run build` – Compile the TypeScript CLI into `dist/`.
- `npm run build:roku` – Invoke BrighterScript (`bsc`) to compile the Roku app sources (Node ≤ 22 recommended until `roku-deploy` updates its dependencies).
- `npm run package:roku` – Create `out/channel.zip` using `roku-deploy` (zips `out/` without contacting a device).
- `npm run generate:brs -- --proto <paths>` – Load `.proto` inputs and emit BrightScript encoders/decoders plus registry files into `roku-app/source/generated/`.
- `npm run generate:baseline -- --proto <paths>` – Render JSON baseline vectors into `fixtures/baseline/` and mirror them into `roku-app/source/generated/__baselineData.brs` for the Roku harness.
- `npm run clean` – Remove build artifacts and generated fixtures.

> Tip: use directories like `proto/` or individual `.proto` files with `--proto`. Multiple values are allowed.

## Quick Start (SimpleMessage demo)

```bash
# Generate the BrightScript encoder/decoder from the sample schema
npm run generate:brs -- --proto proto/simple.proto

# Produce baseline JSON + BrightScript fixture data
npm run generate:baseline -- --proto proto/simple.proto

# Compile Roku sources (requires Node 22 or earlier today)
npm run build:roku

# Side-load ./out/ to a developer Roku device and run the channel
```

The Roku app prints per-case comparisons plus a summary tally. The scaffold currently handles a message with a single string field; expanding the generator logic will broaden coverage.

## Workspace Layout

- `src/` – TypeScript CLI and generation logic.
- `proto/` – Source `.proto` files (recursive discovery).
- `generated/source/` – BrightScript output staging area (consumed by BrighterScript).
- `fixtures/baseline/` – JavaScript baseline data for cross-platform validation.
- `roku-app/` – Roku application skeleton that will load generated code and fixtures.

## Next Steps

1. Broaden generator coverage (additional numeric types, bytes, repeated fields, nested messages, enums).
2. Allow configurable fixtures (custom values, multiple cases per message, failure scenarios).
3. Automate Roku deployment/execution (roku-deploy integration, on-device reporting).
4. Add automated testing (TypeScript unit coverage + BrightScript simulation tests).
