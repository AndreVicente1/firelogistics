# Fire Logistics Agent Contract

This repository is maintained by coding agents. These rules are mandatory for every change.

## Architecture

- Keep domain rules, binary formats, simulation logic, routing, and reusable data loading in `src/FireLogistics.Core`.
- Keep Godot scripts as adapters and renderers. Do not add gameplay rules directly to `src/Main.cs`.
- Do not grow `src/Main.cs` beyond bootstrap orchestration. Add focused runtime classes instead.
- Treat the current JavaScript fire simulation as a prototype until it is moved to, or explicitly contracted with, `FireLogistics.Core`.
- Document every new binary format, IPC message, local asset requirement, and generated-data convention in `docs/contracts.md`.

## Required Checks

- Run `.\test.bat` before handing work back.
- Do not leave C# warnings, TypeScript errors, or failing Node tests.
- Do not commit generated caches, local source datasets, national terrain/vegetation outputs, PMTiles, or other heavy data.
- Prefer deterministic tests for simulation behavior. Visual effects may be nondeterministic only when they do not affect gameplay state.

## Editing Rules

- Preserve the `.flht` v1 format unless a versioned migration and tests are added.
- Keep browser runtime assets compatible with direct `<script>` loading from `assets/web/index.html`.
- Avoid adding build tools unless they are wired into `test.bat` or CI.
- If a task needs local data that is absent, implement a graceful fallback and document the missing asset.
