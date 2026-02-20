# Contributing to amaprice

Thanks for your interest in contributing to `amaprice`.

## Report Bugs

Please open a bug report in [GitHub Issues](https://github.com/marcel-heinz/amaprice-cli/issues/new/choose) and include:

- What command you ran
- The full error output
- Steps to reproduce
- Your environment (OS, Node.js version, npm version)

## Submit Pull Requests

Use the standard flow:

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes with clear commits.
4. Push your branch to your fork.
5. Open a Pull Request against `main`.

Please keep PRs focused and include context on why the change is needed.

## Development Setup

```bash
npm install
node bin/cli.js price "<amazon-product-url>"
```

When running URLs that include query parameters (`?`, `&`), quote the URL so your shell does not split it.

## Code Style and Conventions

- Runtime: Node.js
- Module system: CommonJS (`require` / `module.exports`)
- Language: JavaScript only (no TypeScript in this project)
- Keep changes minimal, readable, and consistent with existing file patterns

## Community Price Database

`amaprice` can store and reuse community price data. Contributions that improve scraping reliability, data quality, and edge-case URL handling help all users get better results.
