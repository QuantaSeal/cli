# Contributing to the QuantaSeal CLI

## Development setup

```bash
git clone https://github.com/quantaseal/cli.git
cd cli
npm install

# Run the CLI locally
node bin/quantaseal --help

# Build binary
npm run build
```

## Pull request guidelines

- Target the `main` branch
- Commands follow the pattern: `quantaseal <noun> <verb>` (e.g. `vault seal`, `encrypt`)
- Help text must be present for all commands and flags

## Licence

Apache 2.0.
