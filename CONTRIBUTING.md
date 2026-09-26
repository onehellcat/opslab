# Contributing to OpsLab

Thanks for helping make OpsLab a clearer DevOps learning project.

## Before opening a pull request

1. Keep the change focused and explain the learning or operational value.
2. Update documentation when behavior, commands, or architecture changes.
3. Run the application checks:

   ```bash
   cd app
   npm ci
   npm run lint
   npm test
   npm run build
   ```

4. If you touch container or deployment configuration, validate the relevant local workflow where possible.

## Project principles

- Keep the default experience local and low-cost.
- Prefer understandable configuration over clever abstraction.
- Teach a realistic operational boundary with every new component.
- Never commit credentials, `.env` files, Terraform state, or generated secrets.

## Issues

Useful issues include a concise reproduction, expected behavior, actual behavior, and your environment. For learning-content suggestions, describe the concept, the intended learner, and why the existing flow is insufficient.

## Code of conduct

Be constructive, respectful, and generous with context. We are here to learn together.
