# Contributing

The ongoing development repository is https://github.com/RageRizzzler/Samarth-Care. This repository receives consolidated, verified showcase releases. Use the development repository for iterative feature work and fixes.

## Before a change

Read `docs/PROJECT_STATUS.md` and the relevant implementation contract. Use a clean local fixture or disposable cloud test project. Preserve collaborator changes and keep algorithms compatible between the website and scheduled worker.

## Verification

```bash
npm ci
npm run check:repo
npm test
npm run typecheck
npm run build:vercel
```

Run relevant hosted SQL fixtures separately only after reviewing their target and rollback boundary. Device tests, model requests and carrier calls can have external effects and are not implied by passing unit tests.

For model changes, preserve the frozen evaluation split and provenance, report exact denominators and compare compatible allocations. Do not retune against a final test set or relabel synthetic measurements as clinical accuracy. For UI changes, verify the actual route and role flow as well as types/build output.

## Publication

Batch related work into one meaningful milestone. Fetch the target branch, review collaborator changes and never force-push shared branches. The showcase and development histories are separate; sync reviewed content without merging unrelated histories.

Exclude credentials, private environment files, personal contact details, output directories, database dumps, recordings and generated builds. Do not invent test results, team contributions, live integration acceptance or licence permissions. Include the user-visible effect, verification and remaining limitation in the change description.
